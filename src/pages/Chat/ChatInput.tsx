/**
 * Chat Input Component
 * Lexical composer with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { SendHorizontal, Square, X, Paperclip, FileText, Film, Music, FileArchive, File, FolderOpen, Loader2, AtSign, Search, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import { useProviderStore } from '@/stores/providers';
import { buildConfiguredModelOptions, formatModelRefLabel, isConfiguredModelRefAvailable, resolveConfiguredModelRef } from '@/lib/model-options';
import type { AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { collectDroppedFiles } from '@/lib/collect-dropped-files';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import { ChatLexicalComposer, type ChatLexicalComposerHandle } from './composer/ChatLexicalComposer';
import { hasSendableComposerValue, serializeComposerValue } from './composer/serialization';
import type { ComposerSkillChip, ComposerValue } from './composer/types';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;        // disk path for gateway
  preview: string | null;    // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  workspaceLabel?: string;
  workspacePath?: string;
  workspaceReadOnly?: boolean;
  onSelectWorkspace?: (path: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────

const DIRECTORY_MIME_TYPE = 'application/x-directory';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === DIRECTORY_MIME_TYPE) return <FolderOpen className={className} />;
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  sending = false,
  workspaceLabel,
  workspacePath,
  workspaceReadOnly = false,
  onSelectWorkspace,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [composerValue, setComposerValue] = useState<ComposerValue>({ text: '', agent: null, skill: null });
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [switchingModelRef, setSwitchingModelRef] = useState<string | null>(null);
  const [optimisticModelRef, setOptimisticModelRef] = useState<string | null>(null);
  const composerRef = useRef<ChatLexicalComposerHandle>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const agents = useAgentsStore((s) => s.agents);
  const updateAgentModel = useAgentsStore((s) => s.updateAgentModel);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const providerVendors = useProviderStore((s) => s.vendors);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = useMemo(
    () => currentAgent?.name ?? currentAgentId,
    [currentAgent, currentAgentId],
  );
  const modelOptions = useMemo(
    () => buildConfiguredModelOptions(
      providerAccounts,
      providerStatuses,
      providerVendors,
      providerDefaultAccountId,
    ),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );
  const configuredModelRef = useMemo(
    () => resolveConfiguredModelRef(currentAgent?.modelRef, defaultModelRef, modelOptions),
    [currentAgent?.modelRef, defaultModelRef, modelOptions],
  );
  const effectiveModelRef = optimisticModelRef || configuredModelRef;
  const currentModelLabel = useMemo(() => {
    const matchedOption = modelOptions.find((option) => option.modelRef === effectiveModelRef);
    return matchedOption?.label || formatModelRefLabel(effectiveModelRef);
  }, [effectiveModelRef, modelOptions]);
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const serializedComposer = useMemo(() => serializeComposerValue(composerValue), [composerValue]);
  const selectedTargetId = composerValue.agent?.id ?? null;
  const filteredQuickSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return quickSkills;
    return quickSkills.filter((skill) =>
      skill.name.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query)
      || skill.sourceLabel.toLowerCase().includes(query),
    );
  }, [quickSkills, skillQuery]);
  const showAgentPicker = mentionableAgents.length > 0;
  const showModelPicker = modelOptions.length >= 1;
  const chatComposerStatusComponents = rendererExtensionRegistry.getChatComposerStatusComponents();
  const isGatewayUsable = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;
  const inputDisabled = disabled;
  const workspaceSelectorDisabled = workspaceReadOnly || inputDisabled || sending || !onSelectWorkspace;
  const openArtifactPreview = useArtifactPanel((s) => s.openPreview);
  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (gatewayStatus.state === 'running') return;
    let cancelled = false;
    hostApi.gateway.status()
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'running') {
          void refreshProviderSnapshot();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gatewayStatus.state, refreshProviderSnapshot]);

  useEffect(() => {
    setOptimisticModelRef(null);
  }, [currentAgent?.modelRef, currentAgentId]);

  useEffect(() => {
    if (!currentAgent || switchingModelRef || optimisticModelRef) return;
    const override = (currentAgent.overrideModelRef || '').trim();
    if (!override || isConfiguredModelRefAvailable(override, modelOptions)) return;
    void updateAgentModel(currentAgent.id, null).catch(() => {});
  }, [currentAgent, modelOptions, optimisticModelRef, switchingModelRef, updateAgentModel]);

  // Focus composer on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (!inputDisabled) {
      composerRef.current?.focus();
    }
  }, [inputDisabled]);

  useEffect(() => {
    if (!selectedTargetId) return;
    if (selectedTargetId === currentAgentId || !(agents ?? []).some((agent) => agent.id === selectedTargetId)) {
      composerRef.current?.clearAgent();
      setComposerValue((value) => (
        value.agent?.id === selectedTargetId ? { ...value, agent: null } : value
      ));
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, selectedTargetId]);

  useEffect(() => {
    if (!pickerOpen && !skillPickerOpen && !modelPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideAgentPicker = pickerRef.current?.contains(target);
      const insideSkillPicker = skillPickerRef.current?.contains(target);
      const insideModelPicker = modelPickerRef.current?.contains(target);
      if (!insideAgentPicker && !insideSkillPicker && !insideModelPicker) {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [modelPickerOpen, pickerOpen, skillPickerOpen]);

  useEffect(() => {
    composerRef.current?.clearSkill();
    setComposerValue((value) => (value.skill ? { ...value, skill: null } : value));
    setSkillPickerOpen(false);
    setSkillQuery('');
    setQuickSkills([]);
    setSkillsError(null);
  }, [currentAgentId]);

  const loadQuickSkills = useCallback(async (): Promise<QuickAccessSkill[]> => {
    if (!currentAgent) {
      setQuickSkills([]);
      setSkillsError(null);
      return [];
    }
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await fetchQuickAccessSkills({
        workspace: currentAgent.workspace,
        agentDir: currentAgent.agentDir,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load skills');
      }
      const list = result.skills || [];
      setQuickSkills(list);
      return list;
    } catch (error) {
      setQuickSkills([]);
      setSkillsError(String(error));
      return [];
    } finally {
      setSkillsLoading(false);
    }
  }, [currentAgent]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    void loadQuickSkills();
  }, [skillPickerOpen, loadQuickSkills]);

  const handleSelectModel = useCallback(async (modelRef: string) => {
    if (!currentAgent || switchingModelRef) return;
    if (modelRef === effectiveModelRef) {
      setModelPickerOpen(false);
      composerRef.current?.focus();
      return;
    }

    const previousModelRef = effectiveModelRef;
    const desiredOverride = modelRef === (defaultModelRef || '').trim() ? null : modelRef;
    setSwitchingModelRef(modelRef);
    setOptimisticModelRef(modelRef);
    setModelPickerOpen(false);
    try {
      await updateAgentModel(currentAgent.id, desiredOverride);
    } catch (error) {
      setOptimisticModelRef(previousModelRef);
      toast.error(t('composer.modelSwitchFailed', { error: String(error) }));
    } finally {
      setSwitchingModelRef(null);
      composerRef.current?.focus();
    }
  }, [currentAgent, defaultModelRef, effectiveModelRef, switchingModelRef, t, updateAgentModel]);

  const handleSelectWorkspace = useCallback(async () => {
    if (workspaceSelectorDisabled || !onSelectWorkspace) return;
    try {
      const result = await hostApi.dialog.open({
        title: t('composer.workspacePickerTitle'),
        buttonLabel: t('composer.workspacePickerButton'),
        defaultPath: workspacePath,
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0]?.trim();
      if (!result.canceled && selected) onSelectWorkspace(selected);
    } catch {
      toast.error(t('composer.workspacePickerFailed'));
    }
  }, [onSelectWorkspace, t, workspacePath, workspaceSelectorDisabled]);

  // ── File staging via native dialog / Electron drag-drop paths ──

  const stagePathFiles = useCallback(async (filePaths: string[]) => {
    if (filePaths.length === 0) return;

    const tempIds: string[] = [];
    for (const filePath of filePaths) {
      const tempId = crypto.randomUUID();
      tempIds.push(tempId);
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName,
        mimeType: '',
        fileSize: 0,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);
    }

    try {
      console.log('[stagePathFiles] Staging files:', filePaths);
      const staged = await hostApi.files.stagePaths({ filePaths });
      console.log('[stagePathFiles] Stage result:', staged?.map(s => ({ id: s?.id, fileName: s?.fileName, mimeType: s?.mimeType, fileSize: s?.fileSize, stagedPath: s?.stagedPath, hasPreview: !!s?.preview })));

      setAttachments(prev => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map(a =>
              a.id === tempId
                ? { ...data, status: 'ready' as const }
                : a,
            );
          } else {
            console.warn(`[stagePathFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map(a =>
              a.id === tempId
                ? { ...a, status: 'error' as const, error: 'Staging failed' }
                : a,
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[stagePathFiles] Failed to stage files:', err);
      setAttachments(prev => prev.map(a =>
        a.status === 'staging'
          ? { ...a, status: 'error' as const, error: String(err) }
          : a,
      ));
    }
  }, []);

  const pickFiles = useCallback(async () => {
    try {
      const result = await hostApi.dialog.open({
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || !result.filePaths?.length) return;
      await stagePathFiles(result.filePaths);
    } catch (err) {
      console.error('[pickFiles] Failed to open file dialog:', err);
    }
  }, [stagePathFiles]);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        console.log(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        const staged = await hostApi.files.stageBuffer({
          base64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
        console.log(`[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`);
        setAttachments(prev => prev.map(a =>
          a.id === tempId ? { ...staged, status: 'ready' as const } : a,
        ));
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments(prev => prev.map(a =>
          a.id === tempId
            ? { ...a, status: 'error' as const, error: String(err) }
            : a,
        ));
      }
    }
  }, []);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = hasSendableComposerValue(composerValue, attachments.length) && allReady && !inputDisabled && !sending;
  const canStop = sending && !inputDisabled && !!onStop;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    const textToSend = serializedComposer.text;
    const targetAgentId = serializedComposer.targetAgentId;
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;

    if (rendererExtensionRegistry.hasChatBeforeSendHooks()) {
      const guard = await rendererExtensionRegistry.runChatBeforeSend({
        text: textToSend,
        attachments: attachmentsToSend,
        targetAgentId,
      });
      if (!guard.ok) {
        if (guard.message) {
          toast.error(guard.message);
        }
        return;
      }
    }

    // Capture values before clearing — clear composer immediately for snappy UX,
    // but keep attachments available for the async send
    console.log(`[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`);
    if (attachmentsToSend) {
      console.log('[handleSend] Attachment details:', attachmentsToSend.map(a => ({
        id: a.id, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize,
        stagedPath: a.stagedPath, status: a.status, hasPreview: !!a.preview,
      })));
    }
    composerRef.current?.clear();
    setComposerValue({ text: '', agent: null, skill: null });
    setAttachments([]);
    setSkillQuery('');
    onSend(textToSend, attachmentsToSend, targetAgentId);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setModelPickerOpen(false);
  }, [attachments, canSend, onSend, serializedComposer]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [stageBufferFiles],
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (!e.dataTransfer) return;

      const { pathFiles, bufferFiles } = collectDroppedFiles(e.dataTransfer);
      if (pathFiles.length === 0 && bufferFiles.length === 0) {
        toast.error(t('composer.folderDropUnsupported'));
        return;
      }
      if (pathFiles.length > 0) void stagePathFiles(pathFiles);
      if (bufferFiles.length > 0) void stageBufferFiles(bufferFiles);
    },
    [stageBufferFiles, stagePathFiles, t],
  );

  return (
    <div
      className={cn(
        "p-4 pb-6 w-full mx-auto max-w-3xl"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {sending && (
          <div
            data-testid="chat-composer-working-indicator"
            role="status"
            aria-live="polite"
            aria-label={t('composer.working')}
            className="relative mb-2 h-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
          >
            <span className="sr-only">{t('composer.working')}</span>
            <span className="clawx-chat-working-rail-bar absolute inset-y-0 block w-16 rounded-full bg-primary/70 shadow-[0_0_14px_hsl(var(--primary)/0.28)]" />
          </div>
        )}

        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input Container */}
        <div className={`relative bg-surface-modal rounded-2xl shadow-sm border px-3 pt-2.5 pb-1.5 transition-all ${dragOver ? 'border-primary ring-1 ring-primary' : 'border-black/10 dark:border-white/10'}`}>
          {/* Text Row — flush-left */}
          <div className="relative min-h-[48px]">
            <ChatLexicalComposer
              ref={composerRef}
              disabled={inputDisabled}
              ariaLabel={t('composer.inputLabel')}
              placeholder={inputDisabled ? t('composer.gatewayDisconnectedPlaceholder') : ''}
              agents={mentionableAgents}
              skills={quickSkills}
              skillsLoading={skillsLoading}
              skillsError={skillsError}
              labels={{
                agentTitle: t('composer.agentPickerTitle', { currentAgent: currentAgentName }),
                skillTitle: t('composer.skillPickerTitle', { agent: currentAgentName }),
                agentEmpty: t('composer.agentEmpty'),
                skillEmpty: t('composer.skillEmpty'),
                skillLoading: t('composer.skillLoading'),
              }}
              onChange={setComposerValue}
              onSubmit={handleSend}
              onEscape={() => {
                setPickerOpen(false);
                setSkillPickerOpen(false);
                setModelPickerOpen(false);
              }}
              onRequestSkills={() => {
                void loadQuickSkills();
              }}
              onPreviewSkill={(skill) => openArtifactPreview(buildPreviewTarget(skill.manifestPath))}
              onPaste={handlePaste}
            />
          </div>

          {/* Action Row — icons on their own line */}
          <div className="mt-1.5 flex items-center gap-1">
            {/* Attach Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
              onClick={pickFiles}
              disabled={inputDisabled || sending}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>

            {showAgentPicker && (
              <div ref={pickerRef} className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="chat-composer-agent"
                  className={cn(
                    'h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
                    (pickerOpen || composerValue.agent) && 'bg-primary/10 text-primary hover:bg-primary/20'
                  )}
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setModelPickerOpen(false);
                    setPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending}
                  title={t('composer.pickAgent')}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                {pickerOpen && (
                  <div className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {mentionableAgents.map((agent) => (
                        <AgentPickerItem
                          key={agent.id}
                          agent={agent}
                          selected={agent.id === selectedTargetId}
                          onSelect={() => {
                            composerRef.current?.insertAgent({
                              kind: 'agent',
                              id: agent.id,
                              name: agent.name,
                              modelDisplay: agent.modelDisplay,
                            });
                            setPickerOpen(false);
                            composerRef.current?.focus();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={skillPickerRef} className="relative shrink-0">
              <button
                type="button"
                data-testid="chat-composer-skill"
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                  (skillPickerOpen || composerValue.skill) && 'text-foreground',
                )}
                onClick={() => {
                  setPickerOpen(false);
                  setModelPickerOpen(false);
                  setSkillPickerOpen((open) => !open);
                }}
                disabled={inputDisabled || sending}
                title={t('composer.pickSkill')}
              >
                <span>{t('composer.skillButton')}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', skillPickerOpen && 'rotate-180')} />
              </button>
              {skillPickerOpen && (
                <div className="absolute left-0 bottom-full z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
                  <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={skillQuery}
                      onChange={(event) => setSkillQuery(event.target.value)}
                      placeholder={t('composer.skillSearchPlaceholder')}
                      className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground/70"
                      autoFocus
                    />
                  </div>
                  <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                    {t('composer.skillPickerTitle', { agent: currentAgentName })}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {skillsLoading ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillLoading')}
                      </div>
                    ) : skillsError ? (
                      <div className="px-3 py-4 text-xs text-destructive">
                        {skillsError}
                      </div>
                    ) : filteredQuickSkills.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillEmpty')}
                      </div>
                    ) : (
                      filteredQuickSkills.map((skill) => (
                        <SkillPickerItem
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={composerValue.skill?.manifestPath === skill.manifestPath}
                          onSelect={() => {
                            composerRef.current?.insertSkill({ ...skill, kind: 'skill' } satisfies ComposerSkillChip);
                            setSkillPickerOpen(false);
                            setSkillQuery('');
                            composerRef.current?.focus();
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1" />

            {showModelPicker && (
              <div ref={modelPickerRef} className="relative shrink-0">
                <button
                  type="button"
                  data-testid="chat-model-picker-button"
                  className={cn(
                    'inline-flex h-8 max-w-[220px] items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                    (modelPickerOpen || switchingModelRef) && 'text-foreground',
                  )}
                  onClick={() => {
                    setPickerOpen(false);
                    setSkillPickerOpen(false);
                    setModelPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending || !currentAgent || !!switchingModelRef}
                  title={t('composer.pickModel')}
                >
                  {switchingModelRef ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : null}
                  <span className="truncate">{currentModelLabel}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', modelPickerOpen && 'rotate-180')} />
                </button>
                {modelPickerOpen && (
                  <div
                    className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                    data-testid="chat-model-picker-menu"
                  >
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.modelPickerTitle')}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {modelOptions.map((option) => (
                        <button
                          key={option.modelRef}
                          type="button"
                          onClick={() => void handleSelectModel(option.modelRef)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                            option.modelRef === effectiveModelRef ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
                          )}
                          data-testid={`chat-model-picker-option-${option.label}`}
                        >
                          <span className="truncate">{option.label}</span>
                          {option.modelRef === effectiveModelRef && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Send Button — pushed to the right */}
            <Button
              onClick={sending ? handleStop : handleSend}
              disabled={sending ? !canStop : !canSend}
              size="icon"
              data-testid="chat-composer-send"
              className={`shrink-0 h-8 w-8 rounded-lg transition-colors ${
                (sending || canSend)
                  ? 'bg-black/5 dark:bg-white/10 text-foreground hover:bg-black/10 dark:hover:bg-white/20'
                  : 'text-muted-foreground/50 hover:bg-transparent bg-transparent'
              }`}
              variant="ghost"
              title={sending ? t('composer.stop') : t('composer.send')}
            >
              {sending ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <SendHorizontal className="h-4 w-4" strokeWidth={2} />
              )}
            </Button>
          </div>
        </div>
        <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 text-tiny text-muted-foreground/60 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <div className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              isGatewayUsable ? "bg-green-500/80" : "bg-red-500/80",
            )} />
            <span className="min-w-0 truncate">
              {t('composer.gatewayStatus', {
                state: isGatewayUsable
                  ? t('composer.gatewayConnected')
                  : gatewayStatus.state === 'running'
                    ? t('composer.gatewayStarting')
                    : gatewayStatus.state,
                port: gatewayStatus.port,
                pid: gatewayStatus.pid ?? '',
              })}
            </span>
            {workspaceLabel && workspacePath && (
              <button
                type="button"
                data-testid="chat-workspace-selector"
                title={workspacePath}
                aria-disabled={workspaceSelectorDisabled ? 'true' : undefined}
                onClick={handleSelectWorkspace}
                className={cn(
                  'ml-2 inline-flex min-w-0 max-w-[240px] shrink items-center gap-1 rounded-full border border-black/10 px-2 py-0.5',
                  'bg-black/[0.02] text-tiny font-medium text-foreground/75 transition-colors dark:border-white/10 dark:bg-white/[0.04]',
                  workspaceSelectorDisabled
                    ? 'cursor-default opacity-80'
                    : 'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                )}
              >
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">
                  {t('composer.workspacePrefix', { workspace: workspaceLabel })}
                </span>
              </button>
            )}
            {chatComposerStatusComponents.map((Component, index) => (
              <Component key={`${index}`} gatewayStatus={gatewayStatus} />
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {hasFailedAttachments && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-tiny"
                onClick={() => {
                  setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                  void pickFiles();
                }}
              >
                {t('composer.retryFailedAttachments')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const { t } = useTranslation('chat');
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border">
      {isImage ? (
        // Image thumbnail
        <div className="w-16 h-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        // Generic file card
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-input/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-2xs text-muted-foreground">
              {attachment.mimeType === DIRECTORY_MIME_TYPE
                ? t('composer.folderAttachment')
                : attachment.fileSize > 0
                  ? formatFileSize(attachment.fileSize)
                  : '...'}
            </p>
          </div>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-2xs text-destructive font-medium px-1">Error</span>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <span className="text-sm font-medium text-foreground">{agent.name}</span>
      <span className="text-tiny text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}

function SkillPickerItem({
  skill,
  selected,
  onSelect,
}: {
  skill: QuickAccessSkill;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`chat-composer-skill-option-${skill.name}`}
          onClick={onSelect}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors',
            selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-meta font-semibold text-foreground">
              <span className="font-mono">/{skill.name}</span>
            </div>
            <div className="truncate text-tiny text-muted-foreground">
              {skill.sourceLabel}
            </div>
          </div>
          <span className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
            {skill.sourceLabel}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
        {skill.description}
      </TooltipContent>
    </Tooltip>
  );
}

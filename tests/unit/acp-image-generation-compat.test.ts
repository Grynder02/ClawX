import { describe, expect, it } from 'vitest';
import {
  extractImageGenerationCompletionFromGatewayChatMessage,
  extractImageGenerationCompletionFromRuntimeEvent,
  extractImageGenerationStartFromAcpEnvelope,
  imageGenerationEvidenceKey,
} from '@/lib/acp/image-generation-compat';

const SESSION_KEY = 'agent:main:main';
const TASK_ID = '32aa3a12-a05b-4074-af4e-246cc4a9a303';

describe('ACP image-generation compatibility extraction', () => {
  it('extracts a background image-generation task id from ACP tool output', () => {
    const start = extractImageGenerationStartFromAcpEnvelope({
      sessionKey: SESSION_KEY,
      generation: 1,
      notification: {
        sessionId: SESSION_KEY,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-image',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${TASK_ID}). Do not call image_generate again.`,
            },
          }],
        },
      },
    });

    expect(start).toEqual({
      sessionKey: SESSION_KEY,
      taskId: TASK_ID,
      toolCallId: 'tool-image',
      evidenceId: `start:${SESSION_KEY}:tool-image:${TASK_ID}`,
    });
  });

  it('extracts message-tool media URLs from Gateway chat-message payloads', () => {
    const evidence = extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        state: 'final',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: {
            mediaUrl: '/Users/me/.openclaw/media/outgoing/sky.png',
            sourceReply: {
              mediaUrls: ['/api/chat/media/outgoing/session/attachment-1/file'],
            },
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      sessionKey: SESSION_KEY,
      source: 'gateway-chat-message',
      caption: 'Generated image is ready.',
    });
    expect(evidence?.candidates).toEqual([
      { key: '/Users/me/.openclaw/media/outgoing/sky.png', filePath: '/Users/me/.openclaw/media/outgoing/sky.png', mimeType: 'image/png' },
      { key: '/api/chat/media/outgoing/session/attachment-1/file', gatewayUrl: '/api/chat/media/outgoing/session/attachment-1/file' },
    ]);
  });

  it('extracts runtime assistant media URLs from active session events', () => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-clouds.webp'],
    });

    expect(evidence?.candidates).toEqual([
      { key: '/tmp/generated-clouds.webp', filePath: '/tmp/generated-clouds.webp', mimeType: 'image/webp' },
    ]);
  });

  it('rejects arbitrary assistant MEDIA text without structured media fields', () => {
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'MEDIA:/tmp/not-trusted.png' }],
        },
      },
    })).toBeNull();
  });

  it('rejects untrusted Gateway structured media fields', () => {
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'read',
          details: { mediaUrl: '/tmp/not-image-generation.png' },
        },
      },
    })).toBeNull();

    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        runId: 'run-1',
        message: {
          role: 'assistant',
          mediaUrls: ['/tmp/not-structured-delivery.png'],
        },
      },
    })).toBeNull();

    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        runId: 'run-1',
        message: {
          role: 'assistant',
          _attachedFiles: [],
          mediaUrls: ['/tmp/not-trusted.png'],
        },
      },
    })).toBeNull();

    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      sessionKey: SESSION_KEY,
      runId: 'run-1',
      mediaUrls: ['/tmp/not-gateway-chat-message.png'],
    })).toBeNull();
  });

  it('rejects non-image media candidates', () => {
    expect(extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-report.pdf'],
    })).toBeNull();
  });

  it('builds source-agnostic evidence keys from image candidate sets', () => {
    const gatewayEvidence = extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        state: 'final',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: { mediaUrls: ['/tmp/generated-clouds.webp', '/tmp/generated-sunset.webp'] },
        },
      },
    });
    const runtimeEvidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-sunset.webp', '/tmp/generated-clouds.webp'],
    });
    const otherRuntimeEvidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-clouds.webp'],
    });

    expect(gatewayEvidence).not.toBeNull();
    expect(runtimeEvidence).not.toBeNull();
    expect(otherRuntimeEvidence).not.toBeNull();
    expect(gatewayEvidence?.evidenceId).not.toBe(runtimeEvidence?.evidenceId);
    expect(imageGenerationEvidenceKey(gatewayEvidence!)).toBe(imageGenerationEvidenceKey(runtimeEvidence!));
    expect(imageGenerationEvidenceKey(runtimeEvidence!)).toBe(
      'agent:main:main:image-generation:["/tmp/generated-clouds.webp","/tmp/generated-sunset.webp"]',
    );
    expect(imageGenerationEvidenceKey(runtimeEvidence!)).not.toBe(imageGenerationEvidenceKey(otherRuntimeEvidence!));

    const collisionEvidenceA = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mimeType: 'image/png',
      mediaUrls: ['a|b', 'c'],
    });
    const collisionEvidenceB = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mimeType: 'image/png',
      mediaUrls: ['a', 'b|c'],
    });

    expect(collisionEvidenceA).not.toBeNull();
    expect(collisionEvidenceB).not.toBeNull();
    expect(imageGenerationEvidenceKey(collisionEvidenceA!)).not.toBe(imageGenerationEvidenceKey(collisionEvidenceB!));
  });
});

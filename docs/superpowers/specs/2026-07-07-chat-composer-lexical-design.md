# Chat Composer Lexical Design

Date: 2026-07-07

## Summary

Replace the current chat composer textarea and transparent token overlay with a Lexical-based composer that supports first-class prefix chips and reusable prefix-trigger dropdowns.

The redesigned composer supports `/` skill chips and `@` agent routing chips at the beginning of the message, preserves the existing toolbar `@` and `Skills` menu entry points, moves the model selector next to Send, and makes the model selector visible even when only one model is available.

## Goals

- Use Lexical as the chat message editor.
- Add an extensible prefix-trigger system for first-position prefixes such as `/` and `@`.
- Use Floating UI for positioned prefix dropdowns and continue using the existing visual language.
- Insert selected prefix candidates as atomic inline chips.
- Support chip deletion with Backspace and Delete.
- Support skill chip click-through to the existing SKILL.md preview experience.
- Route `@Agent` chips to the existing direct-send target path without including `@AgentName` in the sent message text.
- Serialize `/Skill` chips into the message text as an OpenClaw skill prefix.
- Preserve existing toolbar `@` and `Skills` menu interactions, but route their selections through the same chip insertion path.
- Move the model selector to the immediate left of the Send button.
- Always show the model selector when at least one model option exists.
- Cover user-visible behavior with unit/component tests and Electron E2E coverage.

## Non-Goals

- Do not change ACP send transport, Gateway transport policy, or backend communication behavior.
- Do not add direct renderer IPC calls or direct Gateway HTTP calls.
- Do not change skill or agent data source APIs.
- Do not persist draft composer state.
- Do not maintain compatibility with the old transparent-textarea overlay token model.
- Do not redesign attachment staging, gateway status, extension status components, or send/stop behavior beyond the minimum needed to integrate the new editor.

## Current State

`src/pages/Chat/ChatInput.tsx` currently owns the composer UI. It uses a textarea plus a transparent overlay to render skill-like inline tokens. Skill insertion is currently available through the bottom `Skills` menu and inserts text like `/skillName  ` at the textarea cursor. The overlay detects `/...  ` ranges and renders clickable highlighted token buttons.

The existing direct-send `@` menu is separate from the textarea content. It sets `targetAgentId` state and renders a target chip above the input. Sending routes the next message to that agent through the existing `onSend(text, attachments, targetAgentId)` path.

The model selector uses `showModelPicker = modelOptions.length > 1`, so it is hidden when only one configured model option exists.

Lexical and Floating UI are not installed in the project yet. The required dependencies are `lexical`, `@lexical/react`, and `@floating-ui/react`.

## Considered Approaches

### Recommended: Full Lexical Composer Core

Replace the textarea editing core with Lexical and represent both `@Agent` and `/Skill` as custom inline chip nodes. Toolbar menus and typed prefix dropdowns call the same insertion functions. Serialization reads Lexical state and chip metadata to produce message text and `targetAgentId`.

This is the cleanest long-term design. It replaces the current overlay workaround with proper editor primitives and keeps future prefix types extensible.

### Rejected: Lexical Only For Prefix Chips

Keep the current text state path and use Lexical only around prefix chips. This reduces the first diff but creates two editing models, making selection, copy, paste, deletion, and serialization harder to reason about.

### Rejected: Extend The Textarea Overlay

Add `@Agent`, dropdown filtering, and deletion rules to the current overlay. This is the smallest initial change, but it does not satisfy the requested Lexical input direction and would make the existing workaround more brittle.

## Interaction And Layout

The Lexical editor owns visible message content. Prefix chips live only at the logical beginning of the document.

When both chips exist, the fixed visual order is:

```text
@Agent /SkillName message text
```

The `@Agent` chip is route-only metadata. It is removed from the sent message text and becomes `targetAgentId`. The `/SkillName` chip serializes as the leading OpenClaw skill prefix.

For example, this visible composer content:

```text
@Reviewer /code-review check this implementation
```

sends:

```text
/code-review check this implementation
```

with `targetAgentId` set to the reviewer agent.

The bottom action row keeps Attach, `@`, and `Skills` controls. The model selector moves to the immediate left of the Send button. The model selector renders when `modelOptions.length >= 1`; with one model, it remains visible and still opens a menu containing that single selected option. It should only be disabled for the same operational reasons as today, such as no current agent, composer disabled state, sending state, or an in-flight model switch.

## Component Design

Keep `ChatInput` as the owner of existing composer-level concerns: attachments, file staging, send/stop, gateway status, extension status components, model selection, and store integration.

Add a Lexical composer module inside the Chat page area with focused components/plugins:

- `ChatLexicalComposer`: wraps `LexicalComposer`, `ContentEditable`, Lexical plugins, and a small public callback surface for text, chip metadata, empty state, focus, clear, and insertion commands.
- `ComposerChipNode`: a custom inline Lexical node for prefix chips. It stores `kind: 'agent' | 'skill'`, display name, stable id or source key, and optional metadata such as `manifestPath`.
- `PrefixTriggerPlugin`: detects `/` and `@` prefix queries at the logical beginning of the document, manages active trigger state, and coordinates dropdown opening.
- `PrefixDropdown`: shared Floating UI dropdown for prefix suggestions. It renders loading, error, empty, and option states.
- `ComposerSerializationPlugin`: listens to Lexical updates and reports plain text, selected target agent id, selected skill metadata, and sendable state to `ChatInput`.

`ComposerChipNode` should be atomic from the user's perspective. Users can select, skip over, or delete a chip, but cannot place the caret inside the chip label or partially edit its text.

## Data Sources

The redesign reuses existing data sources:

- Skill candidates come from `fetchQuickAccessSkills({ workspace: currentAgent.workspace, agentDir: currentAgent.agentDir })`.
- Agent candidates come from `useAgentsStore((s) => s.agents)` filtered to exclude the current agent.
- Model options come from `buildConfiguredModelOptions(providerAccounts, providerStatuses, providerVendors, providerDefaultAccountId)`.

No renderer code should call IPC directly or call Gateway HTTP endpoints directly. Any future backend need must go through `src/lib/host-api.ts` or `src/lib/api-client.ts`, but this design does not require new backend routes.

## Prefix Rules

Typed prefix dropdowns open only at the logical beginning of the document.

Logical beginning means:

- The document is empty.
- The caret is before normal message text.
- Existing prefix chips and their separator spaces may already be present.

Typing `@` or `/` in the middle of normal message text must behave as normal text and must not open a prefix dropdown.

Selection rules:

- Selecting an agent replaces any existing agent chip.
- Selecting a skill replaces any existing skill chip.
- The fixed prefix order is normalized after insertion: agent chip first, skill chip second, then message text.
- Toolbar `@` and `Skills` buttons use the same selection and replacement logic as typed prefix dropdowns.

## Serialization

Lexical state is the composer source of truth.

Serialization produces three values for send:

- `text`: the message text sent to OpenClaw.
- `attachments`: unchanged ready attachment metadata.
- `targetAgentId`: the selected agent chip id or `null`.

Agent chips are excluded from `text`. Skill chips serialize to `/SkillName` followed by a single separator space before normal text. Empty or whitespace-only normal text can still send a skill-only prompt if the resulting serialized text is non-empty.

After a successful send, `ChatInput` clears Lexical content, attachments, chip metadata, prefix dropdown state, and target agent state.

## Keyboard And Selection Behavior

Keyboard handling should match normal chat input expectations:

- `Enter` sends unless IME composition is active or `Shift+Enter` is used.
- `Shift+Enter` inserts a line break.
- `Escape` closes open prefix, toolbar, or model dropdowns.
- Arrow keys skip across chips atomically when the caret reaches a chip boundary.
- `Backspace` before or after a chip removes the whole chip.
- `Delete` before or after a chip removes the whole chip.
- Clicking a skill chip opens the existing artifact preview target for that skill's `manifestPath`.
- Clicking an agent chip has no special behavior beyond preserving focus and selection.

Dropdown keyboard handling:

- Up and Down move the highlighted candidate.
- Enter selects the highlighted candidate.
- Escape closes the dropdown without selection.
- Mouse selection works without stealing focus permanently from the editor.

## Dropdown Behavior

Floating UI should position prefix dropdowns near the editor/caret region using `useFloating` with `offset`, `flip`, `shift`, and `autoUpdate` while the dropdown is mounted.

The first implementation may anchor to the editor root or a lightweight caret marker if caret-accurate positioning is reliable. If caret anchoring proves unstable in Lexical, anchor to the composer input surface near the prefix line rather than adding a fragile positioning workaround.

Skill options render:

- `/SkillName` as the title.
- Skill description on the next line, single-line with ellipsis.
- Skill source label on the right.

Agent options render:

- `@AgentName` as the title.
- `modelDisplay` as secondary text when available.

Loading, empty, and error states should reuse existing i18n keys where they fit and add new localized keys for new typed-prefix-specific copy.

## I18n And Styling

All new user-facing strings must use `react-i18next` and be added to `shared/i18n/locales/en/chat.json`, `zh/chat.json`, `ja/chat.json`, and `ru/chat.json`.

The UI should use existing design tokens and component conventions from `src/styles/globals.css`, including surface colors, selected state colors, status colors, and existing text size utilities.

The chip styling should preserve the current skill-token feel for `/Skill` while adding a distinct but compatible `@Agent` chip treatment. The final implementation should avoid hardcoded visible strings and avoid introducing an unrelated visual language.

## Error Handling

If skill loading fails, show an inline dropdown error and keep the editor usable. Existing text and chips should not be cleared.

If the selected agent disappears or becomes the current agent, remove the agent chip and clear `targetAgentId`, matching the current target-agent cleanup behavior.

If the selected skill disappears from a refreshed skill list, keep the chip until the user edits or sends. Clicking its preview should attempt to resolve from the cached skill metadata first; if unavailable, show the existing not-found toast.

If no model options are available, the model selector can remain hidden because there is no valid model label to show. The explicit behavior change is for one available model, not zero.

## Testing

Update and add unit/component coverage around `ChatInput` and the new composer module:

- Typed `/` at document start opens skill candidates.
- Typed `/` in the middle of normal message text does not open skill candidates.
- Typed `@` at document start opens agent candidates.
- Typed `@` in the middle of normal message text does not open agent candidates.
- Selecting an agent inserts an `@Agent` chip and sends `targetAgentId` without including `@AgentName` in text.
- Selecting a skill inserts a `/SkillName` chip and serializes it into message text.
- Agent and skill chips can coexist and serialize as route-only agent plus leading skill text.
- Toolbar `@` and `Skills` selections use the same chip path as typed prefix selections.
- Backspace and Delete remove chips atomically.
- Skill chip click opens the existing preview panel.
- The model selector renders with one available model option.

Add or update Electron E2E coverage for user-visible behavior:

- `/` typed at the beginning shows the skill dropdown with title, description, and source label.
- Selecting a skill inserts a chip and clicking it opens the preview sidebar.
- `@` typed at the beginning shows the agent dropdown and selecting an agent routes the next send.
- `@` and `/` chips together route to the agent while sending the skill-prefixed message text.
- The existing toolbar menus still work and insert the same chips.
- The model selector appears immediately before Send and is visible with one available model.

## Documentation

After implementation, review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`.

No README updates are expected unless the richer composer syntax should be documented as a user-facing feature. If documentation is updated, keep locale coverage aligned with the existing README set.

## Validation

Expected validation after implementation:

- `pnpm run typecheck`
- Targeted unit/component tests for `ChatInput` and composer behavior
- Targeted Electron E2E specs for typed prefixes, chips, toolbar compatibility, and model selector visibility/placement
- `pnpm run build:vite`

If the implementation unexpectedly touches communication paths beyond the existing `onSend` target-agent argument, also run the repository communication replay and compare commands.

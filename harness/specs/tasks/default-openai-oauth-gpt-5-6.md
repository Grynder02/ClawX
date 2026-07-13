---
id: default-openai-oauth-gpt-5-6
title: Default new OpenAI browser OAuth accounts to GPT-5.6
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Use GPT-5.6 as the default model when a new OpenAI browser OAuth account is created or an OAuth provider without an explicit model is selected, while preserving explicit existing model choices.
touchedAreas:
  - harness/specs/tasks/default-openai-oauth-gpt-5-6.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/provider-default-invariant.md
  - electron/utils/openclaw-auth.ts
  - electron/utils/browser-oauth.ts
  - electron/services/providers/provider-runtime-sync.ts
  - tests/unit/provider-runtime-sync.test.ts
expectedUserBehavior:
  - A new OpenAI browser OAuth account uses `gpt-5.6` when no model has been selected.
  - Selecting an OpenAI browser OAuth provider without an explicit model configures OpenClaw with `openai/gpt-5.6`.
  - Re-authenticating or selecting an account with an explicit model preserves that model.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - renderer-main-boundary
  - provider-default-invariant
requiredTests:
  - tests/unit/provider-runtime-sync.test.ts
acceptance:
  - One shared OpenAI OAuth default-model constant is used by both account creation and runtime default-provider synchronization.
  - The shared default model is `gpt-5.6`.
  - Explicit existing OAuth account models are not migrated or overwritten.
  - Unit coverage verifies that selecting an OpenAI browser OAuth provider without an explicit model writes `openai/gpt-5.6`.
docs:
  required: false
---

## Scope

Update only the OpenAI browser OAuth default. OpenAI API-key defaults, OpenRouter examples, and existing explicit account model selections are outside this change.

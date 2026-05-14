# 🤖 AI Template Bot

> A Discord bot that uses AI to auto-generate fully configured **channels** and **roles** from a natural language description.

Tell it _"set up a gaming community with public chat, private staff channels, and roles for owner, mod, helper, and member"_ — it builds the entire structure for you, complete with permissions, in seconds.

---

## ✨ Features

- 🎯 **Single slash command** — `/template channel` or `/template role`
- 📝 **Modal-based input** — describe what you want in plain English
- 🧠 **AI-powered** — works with any OpenAI-compatible API (OpenAI, NVIDIA NIM, OpenRouter, local LLMs, etc.)
- 👀 **Preview before commit** — every plan is shown as an embed with ✅ Confirm / ❌ Cancel buttons
- 🔐 **Full permission support**
  - **Roles** get appropriate Discord permissions (Administrator, KickMembers, ManageMessages, etc.)
  - **Channels** get per-role permission overwrites and can be marked private (auto-denies `@everyone` view access)
- 🛡️ **Safe by design**
  - Admin-only command
  - Hard caps: ≤ 50 items per generation, ≤ 25 channels per category
  - Validates AI output before touching your server
  - Sanitizes names, hex colors, and permission strings
- ⏱️ **5-minute preview TTL** — abandoned previews auto-expire
- 🪶 **Tiny footprint** — only 2 files, only 2 dependencies (`discord.js`, `dotenv`)

---

## 🎬 How It Works

┌─────────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│ /template role  │ →  │ Modal opens  │ →  │ AI is asked │ →  │ Preview embed│ →  │ Confirm      │
│ /template chan. │    │ Describe it  │    │ to plan it  │    │ + buttons    │    │ Bot creates  │
└─────────────────┘    └──────────────┘    └─────────────┘    └──────────────┘    └──────────────┘

1. Admin runs `/template channel` or `/template role`.
2. A modal pops up asking for a description.
3. Bot sends the description to your configured AI endpoint and asks for a structured JSON plan.
4. Bot validates the JSON, sanitizes everything, and shows an embed preview.
5. Admin clicks **Confirm** → channels/roles are created with all permissions applied.
6. Admin clicks **Cancel** → nothing happens.

### Example: Roles

Input:
> staff hierarchy: owner with all perms, mod who can kick/ban/mute, helper who can only mute, and a regular member role

Output (preview):

• Owner       — #FF0000 [hoist] [mention]
   perms: Administrator
• Moderator   — #3498DB [hoist]
   perms: KickMembers, BanMembers, ManageMessages, ModerateMembers +5 more
• Helper      — #2ECC71 [hoist]
   perms: MuteMembers, ModerateMembers
• Member      — #99AAB5
   perms: none

### Example: Channels

Input:
> gaming community with general chat, valorant and minecraft sections, plus a private staff area

Output (preview):

📁 General
  • # general
  • # introductions
  • [V] lobby

📁 Valorant
  • # valorant-chat
  • # valorant-lfg
  • [V] valorant-voice

🔒 Staff Only
  • # staff-chat 🔒  (2 overwrites)
  • # staff-logs 🔒  (2 overwrites)

---

## 📦 Installation

### Requirements

- **Node.js 18+** (needs built-in `fetch`)
- A **Discord bot application** with token
- An **OpenAI-compatible AI endpoint** + API key

### Step 1 — Clone / download

Drop the two files (`index.js` and `.env`) into an empty folder.

mkdir ai-template-bot && cd ai-template-bot

### Step 2 — Install dependencies

npm init -y
npm install discord.js dotenv

### Step 3 — Create your Discord bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it.
3. Go to **Bot** → **Reset Token** → copy the token.
4. Under **Privileged Gateway Intents**, no special intents are needed.
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`
6. Open the generated URL and invite the bot to your server.

> ⚠️ **Important:** The bot's role must be **above** any roles it creates, otherwise role creation with permissions will fail. Drag the bot's role near the top of the role list in Server Settings → Roles.

### Step 4 — Configure `.env`

Fill in `.env`:

DISCORD_TOKEN=your_discord_bot_token_here

CLIENT_ID=123456789012345678

GUILD_ID=123456789012345678

AI_API_URL=https://integrate.api.nvidia.com/v1
AI_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxx
AI_MODEL=meta/llama-3.3-70b-instruct

#### Supported AI Providers

| Provider | `AI_API_URL` | Example `AI_MODEL` |
|---|---|---|
| **OpenAI** | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| **NVIDIA NIM** | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.3-70b-instruct` |
| **OpenRouter** | `https://openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o-mini` |
| **Groq** | `https://api.groq.com/openai/v1/chat/completions` | `llama-3.3-70b-versatile` |
| **Local (Ollama)** | `http://localhost:11434/v1/chat/completions` | `llama3.1:8b` |
| **Local (LM Studio)** | `http://localhost:1234/v1/chat/completions` | `local-model` |

> The bot auto-appends `/chat/completions` if you only provide the base `/v1` URL.

### Step 5 — Run it

node index.js

You should see:

Logged in as YourBot#1234
AI_API_URL (resolved)=https://integrate.api.nvidia.com/v1/chat/completions
AI_MODEL=meta/llama-3.3-70b-instruct
Registered /template in guild 123456789012345678

The `/template` command is now available in your server instantly (it's guild-scoped).

---

## 🎮 Usage

### Generate Channels

/template channel

A modal opens. Describe what you want:
> _"A study community with sections for math, science, programming, plus a private mod-only area"_

### Generate Roles

/template role

A modal opens. Describe your role hierarchy:
> _"Server staff: owner, admin, senior mod, mod, trial mod. Plus tiered members: VIP, regular, newbie"_

### After submitting

- ✅ **Confirm** — creates everything.
- ❌ **Cancel** — discards the plan.
- ⏱️ If you wait > 5 minutes, the preview expires and you'll need to re-run the command.

---

## 🔧 Configuration & Limits

| Setting | Value | Where |
|---|---|---|
| Max total items per generation | 50 | `MAX_TOTAL` in `index.js` |
| Max channels per category | 25 | `MAX_PER_CATEGORY` in `index.js` |
| Preview TTL | 5 minutes | `PREVIEW_TTL_MS` in `index.js` |
| AI temperature | 0.7 | `callAI()` in `index.js` |
| AI max tokens | 4096 | `callAI()` in `index.js` |

All values can be tweaked directly in `index.js`.

---

## 🩺 Troubleshooting

### `AI endpoint not found (404)`
Your `AI_API_URL` is wrong. The bot auto-appends `/chat/completions`, so use the base `/v1` URL for your provider.

### `AI provider rejected the API key (401)`
Wrong `AI_API_KEY`, or it has no quota/billing.

### `AI provider rejected the request (400)`
Usually a bad `AI_MODEL` name for that provider. Check the provider's model list.

### `Missing Permissions` when creating roles/channels
- Bot is missing `Manage Roles` or `Manage Channels` permission.
- Or the bot's role is **below** roles it's trying to manage. Move the bot's role higher.

### Slash command doesn't appear
- Make sure `GUILD_ID` matches the server you're testing in.
- Re-invite the bot using a URL that includes the `applications.commands` scope.
- Restart the bot — it re-registers on startup.

### AI returns invalid JSON
- Try a more capable model (e.g., GPT-4o-mini, Llama 3.3 70B).
- Rephrase your description more clearly.
- Smaller/local models sometimes struggle with strict JSON output.

---

## 🛡️ Safety Notes

- Only users with **Administrator** permission can run `/template`.
- The bot **never deletes** anything — it only creates.
- AI output is validated and sanitized before any Discord API call.
- Channel/role names are forced to safe characters and length-capped.
- Invalid permission names from the AI are silently dropped (not applied).
- Hex colors that don't match `#RRGGBB` fall back to a neutral default.

---

## 📂 Project Structure

ai-template-bot/
├── index.js     
├── .env         
├── package.json 
└── README.md    

---

## 📜 License

MIT — do whatever you want.

---

## 🙏 Credits

Built with [discord.js](https://discord.js.org/) v14.
Works with any [OpenAI-compatible](https://platform.openai.com/docs/api-reference/chat) chat completions endpoint.

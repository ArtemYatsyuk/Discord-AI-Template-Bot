require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  AI_API_KEY,
  AI_MODEL,
} = process.env;

function normalizeAIUrl(raw) {
  if (!raw) return raw;
  let u = raw.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(u)) return u;
  return `${u}/chat/completions`;
}
const AI_API_URL = normalizeAIUrl(process.env.AI_API_URL);

for (const [k, v] of Object.entries({ DISCORD_TOKEN, CLIENT_ID, GUILD_ID, AI_API_URL, AI_API_KEY, AI_MODEL })) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

const VALID_PERMISSIONS = [
  'CreateInstantInvite','KickMembers','BanMembers','Administrator','ManageChannels',
  'ManageGuild','AddReactions','ViewAuditLog','PrioritySpeaker','Stream','ViewChannel',
  'SendMessages','SendTTSMessages','ManageMessages','EmbedLinks','AttachFiles',
  'ReadMessageHistory','MentionEveryone','UseExternalEmojis','ViewGuildInsights',
  'Connect','Speak','MuteMembers','DeafenMembers','MoveMembers','UseVAD',
  'ChangeNickname','ManageNicknames','ManageRoles','ManageWebhooks',
  'ManageEmojisAndStickers','ManageGuildExpressions','UseApplicationCommands',
  'RequestToSpeak','ManageEvents','ManageThreads','CreatePublicThreads',
  'CreatePrivateThreads','UseExternalStickers','SendMessagesInThreads',
  'UseEmbeddedActivities','ModerateMembers','ViewCreatorMonetizationAnalytics',
  'UseSoundboard','UseExternalSounds','SendVoiceMessages'
];

function filterPerms(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const p of arr) {
    if (typeof p !== 'string') continue;
    const match = VALID_PERMISSIONS.find((v) => v.toLowerCase() === p.trim().toLowerCase());
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

function permsToBitfield(arr) {
  const filtered = filterPerms(arr);
  if (!filtered.length) return 0n;
  return new PermissionsBitField(filtered).bitfield;
}

const pendingPreviews = new Map();
const PREVIEW_TTL_MS = 5 * 60 * 1000;

function storePreview(key, payload) {
  const existing = pendingPreviews.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => pendingPreviews.delete(key), PREVIEW_TTL_MS);
  pendingPreviews.set(key, { ...payload, expiresAt: Date.now() + PREVIEW_TTL_MS, timer });
}

function consumePreview(key) {
  const item = pendingPreviews.get(key);
  if (item?.timer) clearTimeout(item.timer);
  pendingPreviews.delete(key);
  return item;
}

const templateCommand = new SlashCommandBuilder()
  .setName('template')
  .setDescription('AI-generate channels or roles from a description.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('channel').setDescription('Generate a set of channels via AI.'))
  .addSubcommand((s) => s.setName('role').setDescription('Generate a set of roles via AI.'));

async function doAIRequest(payload) {
  const res = await fetch(AI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
      'HTTP-Referer': 'https://github.com/local/ai-template-bot',
      'X-Title': 'AI Template Bot',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function callAI(systemPrompt, userPrompt) {
  const basePayload = {
    model: AI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  };

  let attempt = await doAIRequest({ ...basePayload, response_format: { type: 'json_object' } });

  if (!attempt.ok && attempt.status === 400 && /response_format|json_object|unsupported|invalid/i.test(attempt.text)) {
    attempt = await doAIRequest(basePayload);
  }

  if (!attempt.ok) {
    console.error('[AI] HTTP', attempt.status, 'URL:', AI_API_URL, 'Model:', AI_MODEL);
    console.error('[AI] Body:', attempt.text.slice(0, 1000));

    let friendly;
    switch (attempt.status) {
      case 401: friendly = 'AI provider rejected the API key (401). Check AI_API_KEY.'; break;
      case 403: friendly = 'AI provider forbade the request (403).'; break;
      case 404: friendly = `AI endpoint not found (404). Resolved URL: ${AI_API_URL}`; break;
      case 429: friendly = 'AI provider rate-limited or out of quota (429).'; break;
      case 400: friendly = `AI provider rejected the request (400). AI_MODEL="${AI_MODEL}".`; break;
      default:  friendly = `AI provider returned HTTP ${attempt.status}.`;
    }
    const snippet = attempt.text.replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`${friendly} ${snippet ? `Details: ${snippet}` : ''}`);
  }

  let data;
  try {
    data = JSON.parse(attempt.text);
  } catch {
    throw new Error('AI endpoint returned non-JSON.');
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('AI returned an empty or unexpected response.');
  }

  let cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!cleaned.startsWith('{')) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI returned invalid JSON. Try rephrasing your description.');
  }
}

const PERM_LIST_HINT = VALID_PERMISSIONS.join(', ');

const CHANNEL_SYSTEM_PROMPT = `You are a Discord server architect. Given a user's description, produce a clean channel layout grouped by categories with optional per-role permission overwrites.
Return ONLY raw JSON (no markdown, no code fences, no commentary) matching exactly this schema:
{
  "categories": [
    {
      "name": "string (<=100 chars)",
      "private": true|false,
      "channels": [
        {
          "name": "lowercase-with-dashes (<=100 chars)",
          "type": "text" | "voice",
          "topic": "optional short string",
          "private": true|false,
          "overwrites": [
            {
              "role": "string (role name, or 'everyone' for @everyone)",
              "allow": ["PermissionName", ...],
              "deny":  ["PermissionName", ...]
            }
          ]
        }
      ]
    }
  ]
}
Permission names MUST come from this exact list (PascalCase): ${PERM_LIST_HINT}.
Rules:
- Channel names: lowercase, dashes instead of spaces, no emojis or special chars.
- Keep totals reasonable (<= 50 channels overall, <= 25 per category).
- If a channel/category is "private": true, add an overwrite for role "everyone" with deny: ["ViewChannel"].
- For staff-only channels, use roles like "Staff", "Moderator", "Admin" in overwrites and allow ViewChannel + SendMessages.
- "overwrites" is optional; omit if no special permissions needed.
- Output must start with { and end with }. No prose before or after.`;

const ROLE_SYSTEM_PROMPT = `You are a Discord server architect. Given a user's description, produce a list of roles with appropriate permissions.
Return ONLY raw JSON (no markdown, no code fences, no commentary) matching exactly this schema:
{
  "roles": [
    {
      "name": "string (<=100 chars)",
      "color": "#RRGGBB",
      "hoist": true|false,
      "mentionable": true|false,
      "permissions": ["PermissionName", ...]
    }
  ]
}
Permission names MUST come from this exact list (PascalCase): ${PERM_LIST_HINT}.
Rules:
- Provide a sensible "#RRGGBB" hex color for every role.
- Keep total roles <= 50.
- Assign permissions appropriate to the role's purpose:
  * Owner/Admin -> ["Administrator"]
  * Moderator -> ["KickMembers","BanMembers","ManageMessages","ModerateMembers","ManageNicknames","MuteMembers","MoveMembers","DeafenMembers","ViewAuditLog"]
  * Helper/Support -> ["ManageMessages","ModerateMembers","MuteMembers"]
  * Member/regular -> [] or basic ["ViewChannel","SendMessages","ReadMessageHistory","Connect","Speak"]
  * Bot -> permissions matching its function
- Never give Administrator to non-staff roles.
- "permissions" must always be present (use [] for none).
- Output must start with { and end with }. No prose before or after.`;

const MAX_TOTAL = 50;
const MAX_PER_CATEGORY = 25;

function sanitizeChannelName(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, 100) || 'channel';
}

function sanitizeRoleName(raw) {
  return String(raw || '').trim().slice(0, 100) || 'role';
}

function isValidHex(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim());
}

function validateOverwrites(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const ow of arr) {
    if (!ow || typeof ow.role !== 'string') continue;
    const allow = filterPerms(ow.allow);
    const deny = filterPerms(ow.deny);
    if (!allow.length && !deny.length) continue;
    out.push({ role: ow.role.trim(), allow, deny });
  }
  return out;
}

function validateChannelPlan(plan) {
  if (!plan || !Array.isArray(plan.categories)) throw new Error('Missing "categories" array.');
  const categories = [];
  let total = 0;
  for (const cat of plan.categories) {
    if (!cat || typeof cat.name !== 'string' || !Array.isArray(cat.channels)) continue;
    const catName = sanitizeRoleName(cat.name);
    const isPrivate = !!cat.private;
    const channels = [];
    for (const ch of cat.channels.slice(0, MAX_PER_CATEGORY)) {
      if (total >= MAX_TOTAL) break;
      const type = ch?.type === 'voice' ? 'voice' : 'text';
      const name = sanitizeChannelName(ch?.name);
      const topic = typeof ch?.topic === 'string' ? ch.topic.slice(0, 1024) : undefined;
      const chPrivate = !!ch?.private;
      let overwrites = validateOverwrites(ch?.overwrites);

      if (chPrivate && !overwrites.some((o) => o.role.toLowerCase() === 'everyone')) {
        overwrites.push({ role: 'everyone', allow: [], deny: ['ViewChannel'] });
      }

      channels.push({ name, type, topic, private: chPrivate, overwrites });
      total++;
    }
    if (channels.length) categories.push({ name: catName, private: isPrivate, channels });
    if (total >= MAX_TOTAL) break;
  }
  if (!categories.length) throw new Error('No valid categories/channels produced.');
  return { categories };
}

function validateRolePlan(plan) {
  if (!plan || !Array.isArray(plan.roles)) throw new Error('Missing "roles" array.');
  const roles = [];
  for (const r of plan.roles.slice(0, MAX_TOTAL)) {
    if (!r || typeof r.name !== 'string') continue;
    const permissions = filterPerms(r.permissions);
    roles.push({
      name: sanitizeRoleName(r.name),
      color: isValidHex(r.color) ? r.color.trim() : '#99AAB5',
      hoist: !!r.hoist,
      mentionable: !!r.mentionable,
      permissions,
    });
  }
  if (!roles.length) throw new Error('No valid roles produced.');
  return { roles };
}

function summarizePerms(perms) {
  if (!perms || !perms.length) return 'none';
  if (perms.includes('Administrator')) return 'Administrator';
  if (perms.length <= 4) return perms.join(', ');
  return `${perms.slice(0, 4).join(', ')} +${perms.length - 4} more`;
}

function buildChannelPreviewEmbed(plan) {
  const embed = new EmbedBuilder()
    .setTitle('Channel Plan Preview')
    .setColor(0x5865f2)
    .setDescription('Review below. Confirm to create, or cancel.');

  for (const cat of plan.categories) {
    const lines = cat.channels.map((c) => {
      const marker = c.type === 'voice' ? '[V]' : '#';
      const lock = c.private ? ' 🔒' : '';
      const topic = c.topic ? ` — _${c.topic.slice(0, 50)}_` : '';
      let line = `• ${marker} \`${c.name}\`${lock}${topic}`;
      if (c.overwrites && c.overwrites.length) {
        const ow = c.overwrites.slice(0, 3).map((o) => {
          const a = o.allow.length ? `+${o.allow.length}` : '';
          const d = o.deny.length ? `-${o.deny.length}` : '';
          return `@${o.role}(${a}${a && d ? '/' : ''}${d})`;
        }).join(' ');
        line += `\n    perms: ${ow}${c.overwrites.length > 3 ? ` +${c.overwrites.length - 3}` : ''}`;
      }
      return line;
    });
    const catLabel = `${cat.private ? '🔒 ' : ''}${cat.name}`;
    embed.addFields({ name: catLabel, value: lines.join('\n').slice(0, 1024) || '_empty_' });
  }
  const total = plan.categories.reduce((a, c) => a + c.channels.length, 0);
  embed.setFooter({ text: `${plan.categories.length} categories - ${total} channels` });
  return embed;
}

function buildRolePreviewEmbed(plan) {
  const embed = new EmbedBuilder()
    .setTitle('Role Plan Preview')
    .setColor(0x5865f2)
    .setDescription('Review below. Confirm to create, or cancel.');

  const lines = plan.roles.map((r) => {
    const flags = `${r.hoist ? ' [hoist]' : ''}${r.mentionable ? ' [mention]' : ''}`;
    return `• **${r.name}** — \`${r.color}\`${flags}\n   perms: ${summarizePerms(r.permissions)}`;
  });

  let buf = '';
  let idx = 1;
  for (const line of lines) {
    if ((buf + '\n' + line).length > 1000) {
      embed.addFields({ name: `Roles (part ${idx++})`, value: buf });
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) embed.addFields({ name: `Roles${idx > 1 ? ` (part ${idx})` : ''}`, value: buf });
  embed.setFooter({ text: `${plan.roles.length} roles` });
  return embed;
}

function confirmButtons(type) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`template:confirm:${type}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`template:cancel:${type}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
}

function resolveRoleByName(guild, name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (lower === 'everyone' || lower === '@everyone') return guild.roles.everyone;
  return guild.roles.cache.find((r) => r.name.toLowerCase() === lower) || null;
}

function buildOverwriteObjects(guild, overwrites) {
  if (!overwrites || !overwrites.length) return undefined;
  const out = [];
  for (const ow of overwrites) {
    const role = resolveRoleByName(guild, ow.role);
    if (!role) continue;
    out.push({
      id: role.id,
      allow: permsToBitfield(ow.allow),
      deny: permsToBitfield(ow.deny),
    });
  }
  return out.length ? out : undefined;
}

async function createChannelsFromPlan(guild, plan) {
  const created = [];
  for (const cat of plan.categories) {
    const catOverwrites = cat.private
      ? [{ id: guild.roles.everyone.id, deny: permsToBitfield(['ViewChannel']) }]
      : undefined;

    const category = await guild.channels.create({
      name: cat.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: catOverwrites,
    });
    created.push(`[CAT] ${category.name}${cat.private ? ' (private)' : ''}`);

    for (const ch of cat.channels) {
      const permissionOverwrites = buildOverwriteObjects(guild, ch.overwrites);
      const newCh = await guild.channels.create({
        name: ch.name,
        type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        topic: ch.type === 'text' ? ch.topic : undefined,
        permissionOverwrites,
      });
      const owCount = permissionOverwrites ? permissionOverwrites.length : 0;
      created.push(`  ${ch.type === 'voice' ? '[V]' : '#'} ${newCh.name}${ch.private ? ' 🔒' : ''}${owCount ? ` (${owCount} overwrites)` : ''}`);
    }
  }
  return created;
}

async function createRolesFromPlan(guild, plan) {
  const created = [];
  for (const r of plan.roles) {
    const role = await guild.roles.create({
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: permsToBitfield(r.permissions),
      reason: 'AI template generation',
    });
    created.push(`• ${role.name} — ${summarizePerms(r.permissions)}`);
  }
  return created;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`AI_API_URL (resolved)=${AI_API_URL}`);
  console.log(`AI_MODEL=${AI_MODEL}`);
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: [templateCommand.toJSON()],
    });
    console.log(`Registered /template in guild ${GUILD_ID}`);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'template') {
      const sub = interaction.options.getSubcommand();
      const isChannel = sub === 'channel';

      const modal = new ModalBuilder()
        .setCustomId(`template:modal:${sub}`)
        .setTitle(isChannel ? 'Generate Channels' : 'Generate Roles');

      const input = new TextInputBuilder()
        .setCustomId('description')
        .setLabel(isChannel ? 'Describe the channels you want' : 'Describe the roles you want')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(
          isChannel
            ? 'e.g., gaming server with public general, private staff-only channels with mod perms, voice rooms'
            : 'e.g., owner, admin, moderator with kick/ban/mute, helper with mute only, member, bots'
        )
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('template:modal:')) {
      const type = interaction.customId.split(':')[2];
      const description = interaction.fields.getTextInputValue('description');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let plan;
      try {
        const raw = await callAI(
          type === 'channel' ? CHANNEL_SYSTEM_PROMPT : ROLE_SYSTEM_PROMPT,
          description
        );
        plan = type === 'channel' ? validateChannelPlan(raw) : validateRolePlan(raw);
      } catch (err) {
        console.error('AI/validation error:', err);
        await interaction.editReply({
          content: `Couldn't generate a valid plan.\n\`\`\`${String(err.message).slice(0, 1800)}\`\`\``,
        });
        return;
      }

      const key = `${interaction.user.id}:${type}`;
      storePreview(key, { plan, type });

      const embed = type === 'channel' ? buildChannelPreviewEmbed(plan) : buildRolePreviewEmbed(plan);
      await interaction.editReply({
        content: "Here's the proposed plan. Confirm within 5 minutes:",
        embeds: [embed],
        components: [confirmButtons(type)],
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('template:')) {
      const [, action, type] = interaction.customId.split(':');
      const key = `${interaction.user.id}:${type}`;

      if (action === 'cancel') {
        consumePreview(key);
        await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
        return;
      }

      if (action === 'confirm') {
        const item = consumePreview(key);
        if (!item) {
          await interaction.update({
            content: 'This preview has expired or was already used. Run /template again.',
            embeds: [],
            components: [],
          });
          return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          await interaction.update({ content: 'You need Administrator permission.', embeds: [], components: [] });
          return;
        }

        await interaction.update({ content: 'Creating... please wait.', embeds: [], components: [] });

        try {
          const created =
            item.type === 'channel'
              ? await createChannelsFromPlan(interaction.guild, item.plan)
              : await createRolesFromPlan(interaction.guild, item.plan);

          const summary = created.join('\n').slice(0, 3900);
          const doneEmbed = new EmbedBuilder()
            .setTitle(`Created ${item.type === 'channel' ? 'Channels' : 'Roles'}`)
            .setDescription(summary || '_Nothing created._')
            .setColor(0x57f287);

          await interaction.editReply({ content: '', embeds: [doneEmbed], components: [] });
        } catch (err) {
          console.error('Creation error:', err);
          await interaction.editReply({
            content: `Failed during creation: ${err.message}`,
            embeds: [],
            components: [],
          });
        }
        return;
      }
    }
  } catch (err) {
    console.error('Unhandled interaction error:', err);
    try {
      if (interaction.isRepliable()) {
        const payload = { content: `Unexpected error: ${err.message}`, flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      }
    } catch (_) {}
  }
});

process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

client.login(DISCORD_TOKEN);

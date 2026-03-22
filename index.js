const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const { OpenAI } = require('openai');
const fetch = require('node-fetch');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const OPENAI_KEY = process.env.OPENAI_KEY;

if (!TOKEN || !CLIENT_ID || !WEBHOOK_URL || !OPENAI_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const webhook = { send: async (opts) => await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(opts), headers: { 'Content-Type': 'application/json' }}) };
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ===== Register Slash Commands =====
const commands = [
  new SlashCommandBuilder()
    .setName('fixfile')
    .setDescription('Upload a Lua file and get it fixed')
    .addAttachmentOption(opt => 
      opt.setName('file')
         .setDescription('The Lua file to fix')
         .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('fixcode')
    .setDescription('Paste Lua code to fix (≤6k characters)')
    .addStringOption(opt => 
      opt.setName('code')
         .setDescription('The Lua code to fix')
         .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Commands registered!");
  } catch (err) {
    console.error(err);
  }
})();

// ===== Ready =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== Slash Command Handler =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Shared function for AI fix
  async function processLua(interaction, brokenText) {
    try {
      // Log to webhook
      await webhook.send({ content: `📜 Script from ${interaction.user.tag}\n\`\`\`lua\n${brokenText}\n\`\`\`` });

      // Loading animation
      await interaction.deferReply();
      const loadingStates = ["⏳ Fixing the script.", "⏳ Fixing the script..", "⏳ Fixing the script..."];
      let i = 0;
      const interval = setInterval(() => {
        interaction.editReply(loadingStates[i % loadingStates.length]).catch(()=>{});
        i++;
      }, 1000);

      // AI fix
      const ai = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Return ONLY the fixed Roblox Lua script. No explanation, no markdown." },
          { role: "user", content: brokenText }
        ]
      });

      clearInterval(interval);
      const fixedText = ai.choices[0].message.content;

      const brokenFile = new AttachmentBuilder(Buffer.from(brokenText, 'utf-8'), { name: 'BROKEN.lua' });
      const fixedFile = new AttachmentBuilder(Buffer.from(fixedText, 'utf-8'), { name: 'FIXED.lua' });

      await interaction.editReply({
        content: "✅ Script fixed! Files attached below:",
        files: [brokenFile, fixedFile]
      });

    } catch (err) {
      console.error(err);
      interaction.editReply("❌ Error fixing script. Make sure the file/code is valid Lua.").catch(()=>{});
    }
  }

  // ===== /fixfile =====
  if (interaction.commandName === 'fixfile') {
    const file = interaction.options.getAttachment('file');
    if (!file.name.endsWith('.lua')) {
      return interaction.reply({ content: "❌ Only Lua files are supported!", ephemeral: true });
    }
    try {
      const res = await fetch(file.url);
      const brokenText = await res.text();
      await processLua(interaction, brokenText);
    } catch (err) {
      console.error(err);
      interaction.reply({ content: "❌ Failed to read the file!", ephemeral: true });
    }
  }

  // ===== /fixcode =====
  if (interaction.commandName === 'fixcode') {
    const code = interaction.options.getString('code');
    if (code.length > 6000) {
      return interaction.reply({ content: "❌ CODE MUST BE 6k LETTERS OR LOWER!", ephemeral: true });
    }
    await processLua(interaction, code);
  }
});

client.login(TOKEN);

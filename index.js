const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const { OpenAI } = require('openai');
const fetch = require('node-fetch');

// ====== ENVIRONMENT VARIABLES ======
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const OPENAI_KEY = process.env.OPENAI_KEY;

if (!TOKEN || !CLIENT_ID || !WEBHOOK_URL || !OPENAI_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

// ====== CLIENT SETUP ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const webhook = { send: async (opts) => await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(opts), headers: { 'Content-Type': 'application/json' }}) };
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ====== REGISTER SLASH COMMANDS ======
const commands = [
  new SlashCommandBuilder()
    .setName('fixfile')
    .setDescription('Upload a Lua or TXT file and get it fixed')
    .addAttachmentOption(opt => 
      opt.setName('file')
         .setDescription('The Lua/TXT file to fix')
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

// ====== READY ======
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ====== MAIN PROCESS FUNCTION ======
async function processLua(interaction, brokenText) {
  let interval;
  try {
    // Log the script to webhook
    await webhook.send({ content: `📜 Script from ${interaction.user.tag}\n\`\`\`\n${brokenText}\n\`\`\`` });

    // Defer reply for slash command
    await interaction.deferReply();

    // Loading animation
    const loadingStates = ["⏳ Fixing the script.", "⏳ Fixing the script..", "⏳ Fixing the script..."];
    let i = 0;
    interval = setInterval(() => {
      interaction.editReply(loadingStates[i % loadingStates.length]).catch(()=>{});
      i++;
    }, 1000);

    // AI fixes the script
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Return ONLY the fixed Roblox Lua script. No explanation, no markdown." },
        { role: "user", content: brokenText }
      ]
    });

    clearInterval(interval);
    const fixedText = ai.choices[0].message.content;

    // Create attachments
    const brokenFile = new AttachmentBuilder(Buffer.from(brokenText, 'utf-8'), { name: 'BROKEN.lua' });
    const fixedFile = new AttachmentBuilder(Buffer.from(fixedText, 'utf-8'), { name: 'FIXED.lua' });

    // Send final reply with attachments
    await interaction.editReply({
      content: "✅ Script fixed! Files attached below:",
      files: [brokenFile, fixedFile]
    });

  } catch (err) {
    clearInterval(interval);
    console.error(err);
    interaction.editReply("❌ Error fixing script. Make sure the file/code is valid Lua.").catch(()=>{});
  }
}

// ====== INTERACTION HANDLER ======
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // /fixfile
  if (interaction.commandName === 'fixfile') {
    const file = interaction.options.getAttachment('file');
    if (!file.name.endsWith('.lua') && !file.name.endsWith('.txt')) {
      return interaction.reply({ content: "❌ Only Lua or TXT files are supported!", ephemeral: true });
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

  // /fixcode
  if (interaction.commandName === 'fixcode') {
    const code = interaction.options.getString('code');
    if (code.length > 6000) {
      return interaction.reply({ content: "❌ CODE MUST BE 6k LETTERS OR LOWER!", ephemeral: true });
    }
    await processLua(interaction, code);
  }
});

client.login(TOKEN);

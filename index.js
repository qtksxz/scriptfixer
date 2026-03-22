const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');

// ====== ENVIRONMENT VARIABLES ======
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY; // Your hf token

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !WEBHOOK_URL || !HUGGINGFACE_API_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

// ====== CLIENT SETUP ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const webhook = {
  send: async (opts) =>
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
};

// ====== SLASH COMMANDS ======
const commands = [
  new SlashCommandBuilder()
    .setName('fixfile')
    .setDescription('Upload a Lua or TXT file and get it fixed with explanation')
    .addAttachmentOption((opt) =>
      opt.setName('file').setDescription('The Lua/TXT file to fix').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('fixcode')
    .setDescription('Paste Lua code to fix (≤6k chars) with explanation')
    .addStringOption((opt) =>
      opt.setName('code').setDescription('The Lua code to fix').setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

// ====== REGISTER COMMANDS ======
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash commands registered!');
  } catch (err) {
    console.error(err);
  }
})();

// ====== CLIENT READY ======
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ====== PROCESS LUA FUNCTION ======
async function processLua(interaction, brokenText) {
  let interval;
  try {
    brokenText = brokenText.replace(/[“”]/g, '"').replace(/\s+\(/g, '(').replace(/\u200B/g, '').trim();

    // Log to webhook
    await webhook.send({
      content: `📜 Script from ${interaction.user.tag}\n\`\`\`\n${brokenText}\n\`\`\``,
    });

    await interaction.deferReply();

    // Loading animation
    const loadingStates = ['⏳ Fixing the script.', '⏳ Fixing the script..', '⏳ Fixing the script...'];
    let i = 0;
    interval = setInterval(() => {
      interaction.editReply(loadingStates[i % loadingStates.length]).catch(() => {});
      i++;
    }, 1000);

    // Hugging Face API call
    const res = await fetch('https://api-inference.huggingface.co/models/bigcode/starcoder', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs:
          'You are a Lua programmer. Fix this Lua code EVEN IF IT IS BROKEN. Return working Lua code AND an explanation of what you fixed:\n' +
          brokenText,
        parameters: { max_new_tokens: 500 },
      }),
    });

    clearInterval(interval);

    const data = await res.json();
    let aiResponse = '';
    if (Array.isArray(data)) {
      // Some models return array
      aiResponse = data[0]?.generated_text || '';
    } else {
      aiResponse = data?.generated_text || '';
    }
    aiResponse = aiResponse.replace(/```lua/g, '').replace(/```/g, '').trim();

    // Split code and explanation
    let fixedText = aiResponse;
    let explanation = 'No explanation provided.';
    const explanationIndex = aiResponse.toLowerCase().lastIndexOf('explanation');
    if (explanationIndex !== -1) {
      fixedText = aiResponse.slice(0, explanationIndex).trim();
      explanation = aiResponse.slice(explanationIndex).trim();
    }

    if (!fixedText || fixedText.length < 1) fixedText = brokenText;
    if (!explanation || explanation.length < 1) explanation = 'No explanation provided.';

    // Prepare attachments
    const brokenFile = new AttachmentBuilder(Buffer.from(brokenText, 'utf-8'), { name: 'BROKEN.lua' });
    const fixedFile = new AttachmentBuilder(Buffer.from(fixedText, 'utf-8'), { name: 'FIXED.lua' });
    const explanationFile = new AttachmentBuilder(Buffer.from(explanation, 'utf-8'), { name: 'EXPLANATION.txt' });

    await interaction.editReply({
      content: '✅ Script fixed! Files attached below:',
      files: [brokenFile, fixedFile, explanationFile],
    });
  } catch (err) {
    clearInterval(interval);
    console.error(err);

    // Safe fallback
    const brokenFile = new AttachmentBuilder(Buffer.from(brokenText, 'utf-8'), { name: 'BROKEN.lua' });
    await interaction.editReply({
      content: '⚠️ AI failed to produce output. Original file attached:',
      files: [brokenFile],
    }).catch(() => {});
  }
}

// ====== INTERACTION HANDLER ======
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'fixfile') {
    const file = interaction.options.getAttachment('file');
    if (!file.name.endsWith('.lua') && !file.name.endsWith('.txt')) {
      return interaction.reply({ content: '❌ Only Lua or TXT files are supported!', ephemeral: true });
    }
    try {
      const res = await fetch(file.url);
      const brokenText = await res.text();
      await processLua(interaction, brokenText);
    } catch (err) {
      console.error(err);
      interaction.reply({ content: '❌ Failed to read the file!', ephemeral: true });
    }
  }

  if (interaction.commandName === 'fixcode') {
    const code = interaction.options.getString('code');
    if (code.length > 6000) {
      return interaction.reply({ content: '❌ CODE MUST BE 6k LETTERS OR LOWER!', ephemeral: true });
    }
    await processLua(interaction, code);
  }
});

// ====== LOGIN ======
client.login(TOKEN);

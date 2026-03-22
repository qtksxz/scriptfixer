const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const { OpenAI } = require('openai');
const fetch = require('node-fetch');

// ====== ENVIRONMENT VARIABLES ======
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const OPENAI_KEY = process.env.OPENAI_KEY;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !WEBHOOK_URL || !OPENAI_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

// ====== CLIENT SETUP ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const webhook = { send: async (opts) => await fetch(WEBHOOK_URL, { method: 'POST', body: JSON.stringify(opts), headers: { 'Content-Type': 'application/json' }}) };
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ====== SLASH COMMANDS ======
const commands = [
  new SlashCommandBuilder()
    .setName('fixfile')
    .setDescription('Upload a Lua or TXT file and get it fixed with explanation')
    .addAttachmentOption(opt => 
      opt.setName('file')
         .setDescription('The Lua/TXT file to fix')
         .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('fixcode')
    .setDescription('Paste Lua code to fix (≤6k characters) with explanation')
    .addStringOption(opt => 
      opt.setName('code')
         .setDescription('The Lua code to fix')
         .setRequired(true)
    )
].map(cmd => cmd.toJSON());

// ====== REGISTER COMMANDS TO GUILD ======
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log("Clearing old guild commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });

    console.log("Registering slash commands to guild...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Guild commands registered!");
  } catch (err) {
    console.error(err);
  }
})();

// ====== CLIENT READY ======
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ====== PROCESS LUA FUNCTION WITH EXPLANATION ======
async function processLua(interaction, brokenText) {
  let interval;
  try {
    // Preprocess brokenText
    brokenText = brokenText
      .replace(/[“”]/g, '"')
      .replace(/\s+\(/g, '(')
      .replace(/\u200B/g, '')
      .trim();

    // Log to webhook
    await webhook.send({ content: `📜 Script from ${interaction.user.tag}\n\`\`\`\n${brokenText}\n\`\`\`` });

    // Defer reply
    await interaction.deferReply();

    // Loading animation
    const loadingStates = ["⏳ Fixing the script.", "⏳ Fixing the script..", "⏳ Fixing the script..."];
    let i = 0;
    interval = setInterval(() => {
      interaction.editReply(loadingStates[i % loadingStates.length]).catch(()=>{});
      i++;
    }, 1000);

    // AI call: Fix code and give explanation
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a Lua programmer. You must fix this Lua file EVEN IF IT'S NOT 100% Lua. Return a working Lua script AND a separate explanation of what was broken and what you fixed. Output both clearly."
        },
        { role: "user", content: brokenText }
      ]
    });

    clearInterval(interval);

    // Extract AI response
    let aiResponse = ai.choices[0].message.content.trim();

    // Split AI response: expect it to contain the code and explanation
    // We'll assume AI separates them with a header like "### Explanation"
    let [fixedText, explanation] = aiResponse.split(/### Explanation/i);
    if (!fixedText) fixedText = brokenText;
    if (!explanation) explanation = "No explanation provided.";

    // Clean code output
    fixedText = fixedText.replace(/```lua/g, '').replace(/```/g, '').trim();
    explanation = explanation.replace(/```/g, '').trim();

    // Prepare attachments
    const brokenFile = new AttachmentBuilder(Buffer.from(brokenText, 'utf-8'), { name: 'BROKEN.lua' });
    const fixedFile = new AttachmentBuilder(Buffer.from(fixedText, 'utf-8'), { name: 'FIXED.lua' });
    const explanationFile = new AttachmentBuilder(Buffer.from(explanation, 'utf-8'), { name: 'EXPLANATION.txt' });

    // Send reply
    await interaction.editReply({
      content: "✅ Script fixed! Files attached below:",
      files: [brokenFile, fixedFile, explanationFile]
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

// ====== LOGIN ======
client.login(TOKEN);

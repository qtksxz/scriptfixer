const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, REST, WebhookClient, AttachmentBuilder } = require('discord.js');
const { OpenAI } = require('openai');

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const OPENAI_KEY = process.env.OPENAI_KEY;

// ===== SETUP =====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const webhook = new WebhookClient({ url: WEBHOOK_URL });
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ===== COMMAND =====
const commands = [
  new SlashCommandBuilder()
    .setName('fix-script')
    .setDescription('Fix your Roblox Lua script')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('Paste your script')
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

// ===== REGISTER COMMAND =====
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log("Registering command...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Command registered!");
  } catch (err) {
    console.error(err);
  }
})();

// ===== BOT READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== COMMAND HANDLER =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'fix-script') {
    const code = interaction.options.getString('code');

    if (code.length > 2000) {
      return interaction.reply({
        content: "❌ Script too long!",
        ephemeral: true
      });
    }

    // Send to webhook (log)
    await webhook.send({
      content: `📜 Script from ${interaction.user.tag}\n\`\`\`lua\n${code}\n\`\`\``
    });

    // Loading message
    await interaction.reply("⏳ Fixing the script... hold on.");

    const loadingStates = [
      "⏳ Fixing the script.",
      "⏳ Fixing the script..",
      "⏳ Fixing the script..."
    ];

    let i = 0;
    const interval = setInterval(() => {
      interaction.editReply(loadingStates[i % loadingStates.length]);
      i++;
    }, 1000);

    try {
      // Call OpenAI API
      const ai = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Return ONLY the fixed Roblox Lua script. No explanation, no markdown."
          },
          {
            role: "user",
            content: code
          }
        ]
      });

      clearInterval(interval);

      const fixedCode = ai.choices[0].message.content;

      // Create file attachments
      const fixedFile = new AttachmentBuilder(
        Buffer.from(fixedCode, 'utf-8'),
        { name: 'FIXED.lua' }
      );

      const brokenFile = new AttachmentBuilder(
        Buffer.from(code, 'utf-8'),
        { name: 'BROKEN.lua' }
      );

      // Send files
      await interaction.editReply({
        content: "✅ Script fixed! Files attached below:",
        files: [fixedFile, brokenFile]
      });

    } catch (err) {
      clearInterval(interval);
      console.error(err);
      await interaction.editReply("❌ Error fixing script.");
    }
  }
});

// ===== LOGIN =====
client.login(TOKEN);

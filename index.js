require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// In-memory map to store channel preferences per guild
const guildChannelMap = new Map();

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Set the channel where Mai should respond')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The text channel')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('removechannel')
    .setDescription('Remove the channel where Mai responds')
].map(command => command.toJSON());

// Register slash commands on bot ready
client.once('ready', async () => {
  console.log(`Mai bot is online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const appId = (await rest.get('/oauth2/applications/@me')).id;

  try {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }

  // Load all saved channels from Supabase
  const { data, error } = await supabase.from('guild_channel_settings').select('*');
  if (data) {
    for (const row of data) {
      guildChannelMap.set(row.guild_id, row.channel_id);
    }
    console.log('✅ Loaded saved channel settings from Supabase');
  }
});

// Slash command interaction handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;

  if (interaction.commandName === 'setchannel') {
    const channel = interaction.options.getChannel('channel');

    await supabase
      .from('guild_channel_settings')
      .upsert({ guild_id: guildId, channel_id: channel.id });

    guildChannelMap.set(guildId, channel.id);

    console.log(`Set channel for guild ${guildId}: ${channel.id}`);

    await interaction.reply({
      content: `✅ Mai will now respond in <#${channel.id}>`,
      ephemeral: true
    });

  } else if (interaction.commandName === 'removechannel') {
    await supabase
      .from('guild_channel_settings')
      .delete()
      .eq('guild_id', guildId);

    guildChannelMap.delete(guildId);

    console.log(`Removed channel for guild ${guildId}`);

    await interaction.reply({
      content: `❌ Mai will no longer respond in any channel.`,
      ephemeral: true
    });
  }
});

// Bot message handler
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const targetChannelId = guildChannelMap.get(message.guildId);
  if (!targetChannelId || message.channel.id !== targetChannelId) return;

  try {
    // 👇 Fetch last 10 messages from Supabase for this Discord user
    const { data: history, error } = await supabase
      .from('discord_messages')
      .select('role, content')
      .eq('discord_user_id', `discord:${message.author.id}`)
      .order('id', { ascending: false })
      .limit(10);

    const shortTermMemory = (history || [])
      .reverse() // oldest to newest
      .map(m => ({
        role: m.role === 'mai' ? 'assistant' : 'user',
        content: m.content
      }));

    const res = await fetch(process.env.NEXT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        userId: `discord:${message.author.id}`,
        message: message.content,
        emotionalState: {
          emotion: "Normal",
          intensity: 3,
          affectionLevel: 50,
          trustLevel: 50,
          interactionCount: 0,
          intrusiveness: 1,
          requiresTeasing: false
        },
        shortTermMemory
      })
    });

    const data = await res.json();
    if (data?.message) {
      message.channel.send(data.message);
    } else {
      message.channel.send("Something went wrong talking to Mai.");
    }
  } catch (e) {
    console.error("API error:", e);
    message.channel.send("Error reaching Mai's brain 😵‍💫");
  }
});


client.login(process.env.DISCORD_TOKEN);

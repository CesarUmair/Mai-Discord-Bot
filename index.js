// bot.js
require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// Supabase client (service role key for server-side operations)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// 1) Create Discord client with DM intents & partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // needed to register slash commands
    GatewayIntentBits.MessageContent,   // read message content
    GatewayIntentBits.DirectMessages    // handle DMs
  ],
  partials: ['CHANNEL']                // allow DM channel partials
});

// 2) Define slash commands (only /myid for DM users)
const commands = [
  new SlashCommandBuilder()
    .setName('myid')
    .setDescription("Display your Discord user ID")
].map(cmd => cmd.toJSON());

// 3) On ready: register slash commands and start reminder cron
client.once('ready', async () => {
  console.log(`Mai bot is online as ${client.user.tag}`);

  // Register global slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const app = await rest.get('/oauth2/applications/@me');
  await rest.put(Routes.applicationCommands(app.id), { body: commands });
  console.log('✅ Slash commands registered');

  // Schedule the 24‑hour DM reminder job (runs at minute 0 of every hour)
  cron.schedule('0 * * * *', async () => {
    console.log('🔔 Running reminder cron…');
    const { data: links, error: linkErr } = await supabase
      .from('discord_user_links')
      .select('discord_user_id');
    if (linkErr) return console.error('Could not load discord_user_links:', linkErr);

    for (const { discord_user_id: userId } of links) {
      try {
        const { data: msgs } = await supabase
          .from('discord_messages')
          .select('emotion, created_at')
          .eq('discord_user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!msgs?.length) continue;
        const last = msgs[0];
        const age = Date.now() - new Date(last.created_at).getTime();
        if (age < ONE_DAY_MS) continue;

        const templates = {
          Angry:   `Hey… I remember you seemed upset last time. I’m here if you want to talk.`,
          Sad:     `You sounded a bit down yesterday. Want to chat and cheer up?`,
          Happy:   `You were in a great mood last time—miss that energy!`,
          Flirty:  `I’ve been thinking about you… care to continue where we left off?`,
          Normal:  `It’s been a while! Curious what’s on your mind today.`,
          Loving:  `Feeling affectionate—is there something you want to share?`,
          Excited: `You were excited last time—got any new fun stories?`
        };
        const text = templates[last.emotion] || templates.Normal;

        const user = await client.users.fetch(userId);
        await user.send({ content: `${text}\n\n💬 Come chat with me!` });
        console.log(`Reminder sent to ${userId} (last emotion=${last.emotion})`);
      } catch (err) {
        console.error(`Failed to send reminder to ${userId}:`, err);
      }
    }
  });
});

// 4) Handle slash commands (only /myid)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'myid') {
    await interaction.reply({ content: `👤 Your Discord ID is: \`${interaction.user.id}\``, ephemeral: true });
  }
});

// 5) Handle incoming DMs only
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // ignore guild channels
  if (message.channel.type !== 'DM') return;

  // verify link exists
  const { data: link } = await supabase
    .from('discord_user_links')
    .select('discord_user_id')
    .eq('discord_user_id', message.author.id)
    .single();

  if (!link) {
    return message.channel.send(
      "🚧 Please link your account first in the web app before chatting here."
    );
  }

  // forward to Next.js chat API
  try {
    const res = await fetch(process.env.NEXT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        userId: `discord:${message.author.id}`,
        message: message.content,
        emotionalState: { emotion: 'Normal', intensity: 3, affectionLevel: 50, trustLevel: 50, interactionCount: 0, intrusiveness: 1, requiresTeasing: false },
        shortTermMemory: []
      })
    });
    const data = await res.json();
    await message.channel.send(data.message || "Something went wrong talking to Mai.");
  } catch (err) {
    console.error('API error:', err);
    await message.channel.send("Error reaching Mai's brain 😵‍💫");
  }
});

// 6) Log in
client.login(process.env.DISCORD_TOKEN);

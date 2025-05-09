require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Create Discord client with DM support
const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel] // Required to receive DMs
});

// Bot ready
client.once('ready', () => {
  console.log(`🤖 Bot is online as ${client.user.tag}`);
});

// Listen to only DMs
client.on('messageCreate', async (message) => {
  if (message.author.bot) return; // Ignore bot messages
  if (message.channel.type !== 1) return; // 1 = ChannelType.DM (hardcoded for compatibility)

  console.log(`[DM RECEIVED] From ${message.author.username} (${message.author.id}): "${message.content}"`);

  try {
    // Send message to your API
    const response = await fetch(process.env.NEXT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        userId: `discord:${message.author.id}`,
        message: message.content,
        emotionalState: {
          emotion: 'Normal',
          intensity: 3,
          affectionLevel: 50,
          trustLevel: 50,
          interactionCount: 0,
          intrusiveness: 1,
          requiresTeasing: false
        },
        shortTermMemory: []
      })
    });

    const data = await response.json();
    const reply = data.message || '🤔 Hmm, I didn’t get a proper reply from Mai.';

    await message.channel.send(reply);
  } catch (error) {
    console.error('❌ Error sending message to API:', error);
    await message.channel.send("💥 Oops! I couldn’t talk to Mai. Please try again later.");
  }
});

// Login bot
client.login(process.env.DISCORD_TOKEN);

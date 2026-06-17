import { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const token = process.env.DISCORD_TOKEN;
const allowedInvites = (process.env.ALLOWED_INVITE_CODES || '')
  .split(',')
  .map(code => code.trim())
  .filter(code => code.length > 0);

const clipsChannelId = process.env.CLIPS_CHANNEL_ID;
const winnerChannelId = process.env.CLIP_OF_THE_DAY_CHANNEL_ID;

const memesChannelIds = (process.env.MEMES_CHANNEL_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0);
const memeWinnerChannelId = process.env.MEME_OF_THE_DAY_CHANNEL_ID;

const readonlyChannelIds = (process.env.READONLY_CHANNEL_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0);

if (!token || token === 'YOUR_DISCORD_TOKEN_HERE') {
  console.error('❌ Error: Please set your DISCORD_TOKEN in the .env file!');
  process.exit(1);
}

// Initialize client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const warnsFilePath = path.join(process.cwd(), 'warns.json');
const clipsFilePath = path.join(process.cwd(), 'clips.json');
const memesFilePath = path.join(process.cwd(), 'memes.json');
const stateFilePath = path.join(process.cwd(), 'state.json');

// Helper to read warnings
function getWarnings() {
  try {
    if (fs.existsSync(warnsFilePath)) {
      const data = fs.readFileSync(warnsFilePath, 'utf8');
      return JSON.parse(data || '{}');
    }
  } catch (err) {
    console.error('Error reading warns.json:', err);
  }
  return {};
}

// Helper to save warnings
function saveWarnings(warns) {
  try {
    fs.writeFileSync(warnsFilePath, JSON.stringify(warns, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to warns.json:', err);
  }
}

// Warn a user and return their warning count
function addWarning(userId, guildId) {
  const warns = getWarnings();
  const key = `${guildId}-${userId}`;
  warns[key] = (warns[key] || 0) + 1;
  saveWarnings(warns);
  return warns[key];
}

// Progressive timeout handler when a user gets multiple warnings
async function handleWarningsAndTimeout(message, warnCount) {
  if (warnCount >= 3) {
    const member = message.member;
    if (member) {
      if (member.moderatable) {
        let duration = 0;
        let durationText = '';
        
        const level = warnCount - 3;
        switch (level) {
          case 0:
            duration = 10 * 60 * 1000; // 10 minutes
            durationText = '10 minutes';
            break;
          case 1:
            duration = 30 * 60 * 1000; // 30 minutes
            durationText = '30 minutes';
            break;
          case 2:
            duration = 2 * 60 * 60 * 1000; // 2 hours
            durationText = '2 hours';
            break;
          case 3:
            duration = 12 * 60 * 60 * 1000; // 12 hours
            durationText = '12 hours';
            break;
          default:
            duration = 24 * 60 * 60 * 1000; // 24 hours
            durationText = '24 hours';
            break;
        }

        try {
          await member.timeout(duration, `Accumulated ${warnCount} warnings`);
          await message.channel.send(`⛔ <@${member.id}> has been timed out for **${durationText}** after receiving warning \`${warnCount}\`.`);
        } catch (err) {
          console.error('Failed to timeout member:', err);
          await message.channel.send(`⚠️ Could not timeout <@${member.id}>. Please check if the bot has "Moderate Members" permissions and is placed higher than their role.`);
        }
      } else {
        await message.channel.send(`⚠️ Cannot moderate <@${member.id}> (they might have administrator permissions or be the server owner).`);
      }
    }
  }
}


// Helper to read clips
function getClips() {
  try {
    if (fs.existsSync(clipsFilePath)) {
      const data = fs.readFileSync(clipsFilePath, 'utf8');
      return JSON.parse(data || '[]');
    }
  } catch (err) {
    console.error('Error reading clips.json:', err);
  }
  return [];
}

// Helper to save clips
function saveClips(clips) {
  try {
    fs.writeFileSync(clipsFilePath, JSON.stringify(clips, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to clips.json:', err);
  }
}

// Helper to read memes
function getMemes() {
  try {
    if (fs.existsSync(memesFilePath)) {
      const data = fs.readFileSync(memesFilePath, 'utf8');
      return JSON.parse(data || '[]');
    }
  } catch (err) {
    console.error('Error reading memes.json:', err);
  }
  return [];
}

// Helper to save memes
function saveMemes(memes) {
  try {
    fs.writeFileSync(memesFilePath, JSON.stringify(memes, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to memes.json:', err);
  }
}

// Helper to get last run date for daily clip/meme selection
function getLastRunDate() {
  try {
    if (fs.existsSync(stateFilePath)) {
      const data = fs.readFileSync(stateFilePath, 'utf8');
      return JSON.parse(data || '{}').lastRunDate || '';
    }
  } catch (err) {
    console.error('Error reading state.json:', err);
  }
  return '';
}

// Helper to save last run date
function saveLastRunDate(dateString) {
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify({ lastRunDate: dateString }), 'utf8');
  } catch (err) {
    console.error('Error writing to state.json:', err);
  }
}

// Function to select the most reacted clip and post it
async function selectAndAnnounceClipOfTheDay(manualChannel = null) {
  const targetWinnerChannelId = winnerChannelId;
  const targetClipsChannelId = clipsChannelId;

  if (!targetClipsChannelId || !targetWinnerChannelId) {
    console.warn('⚠️ Clips channels are not configured in .env!');
    if (manualChannel) {
      await manualChannel.send('⚠️ Error: Please configure `CLIPS_CHANNEL_ID` and `CLIP_OF_THE_DAY_CHANNEL_ID` in your `.env` file first.');
    }
    return;
  }

  const clips = getClips();
  if (clips.length === 0) {
    console.log('No clips found in database to select from.');
    if (manualChannel) {
      await manualChannel.send('⚠️ No clips have been posted/tracked yet today.');
    }
    return;
  }

  try {
    const clipsChannel = await client.channels.fetch(targetClipsChannelId);
    const winnerChannel = await client.channels.fetch(targetWinnerChannelId);

    if (!clipsChannel || !winnerChannel) {
      console.warn('⚠️ Configured channels could not be loaded.');
      if (manualChannel) {
        await manualChannel.send('⚠️ Error: Configured clips channels could not be found or loaded.');
      }
      return;
    }

    const evaluatedClips = [];

    if (manualChannel) {
      await manualChannel.send(`Checking ${clips.length} clip(s) for reactions...`);
    }

    for (const clip of clips) {
      try {
        const msg = await clipsChannel.messages.fetch(clip.messageId);
        const heartReaction = msg.reactions.cache.get('❤️');
        const count = heartReaction ? heartReaction.count - 1 : 0;
        evaluatedClips.push({ ...clip, count });
      } catch (err) {
        console.error(`Skipping clip ${clip.messageId} (possibly deleted):`, err.message);
      }
    }

    if (evaluatedClips.length === 0) {
      if (manualChannel) {
        await manualChannel.send('⚠️ All tracked clips were deleted or couldn\'t be loaded.');
      }
      saveClips([]);
      return;
    }

    // Sort descending by reaction count
    evaluatedClips.sort((a, b) => b.count - a.count);
    const winner = evaluatedClips[0];

    const embed = new EmbedBuilder()
      .setTitle('🎬 Clip of the Day!')
      .setDescription(`Congratulations to <@${winner.authorId}> for getting the most reactions today! 🎉\n\n[Go to Clip Message](https://discord.com/channels/${winnerChannel.guild.id}/${winner.channelId}/${winner.messageId})`)
      .addFields(
        { name: 'Posted By', value: `<@${winner.authorId}>`, inline: true },
        { name: 'Reactions', value: `❤️ \`${winner.count}\``, inline: true }
      )
      .setColor('#ff4757')
      .setTimestamp();

    await winnerChannel.send({
      content: `📢 **Clip of the Day** is here! @everyone\n${winner.url}`,
      embeds: [embed]
    });

    saveClips([]);
    
    if (manualChannel) {
      await manualChannel.send(`🏆 Success! Announced Clip of the Day by <@${winner.authorId}> with ${winner.count} reactions.`);
    }
  } catch (err) {
    console.error('Error selecting Clip of the Day:', err);
    if (manualChannel) {
      await manualChannel.send(`❌ An error occurred: ${err.message}`);
    }
  }
}

// Function to select the most reacted meme and post it
async function selectAndAnnounceMemeOfTheDay(manualChannel = null) {
  const targetWinnerChannelId = memeWinnerChannelId;

  if (memesChannelIds.length === 0 || !targetWinnerChannelId) {
    console.warn('⚠️ Meme channels are not configured in .env!');
    if (manualChannel) {
      await manualChannel.send('⚠️ Error: Please configure `MEMES_CHANNEL_ID` and `MEME_OF_THE_DAY_CHANNEL_ID` in your `.env` file first.');
    }
    return;
  }

  const memes = getMemes();
  if (memes.length === 0) {
    console.log('No memes found in database to select from.');
    if (manualChannel) {
      await manualChannel.send('⚠️ No memes have been posted/tracked yet today.');
    }
    return;
  }

  try {
    const winnerChannel = await client.channels.fetch(targetWinnerChannelId);

    if (!winnerChannel) {
      console.warn('⚠️ Configured meme winner channel could not be loaded.');
      if (manualChannel) {
        await manualChannel.send('⚠️ Error: Configured meme winner channel could not be found or loaded.');
      }
      return;
    }

    const evaluatedMemes = [];

    if (manualChannel) {
      await manualChannel.send(`Checking ${memes.length} meme(s) across ${memesChannelIds.length} channel(s) for reactions...`);
    }

    for (const meme of memes) {
      try {
        const memesChannel = await client.channels.fetch(meme.channelId);
        if (!memesChannel) continue;
        
        const msg = await memesChannel.messages.fetch(meme.messageId);
        const laughReaction = msg.reactions.cache.get('😂');
        const count = laughReaction ? laughReaction.count - 1 : 0;
        
        // Save attachment URL if the message had one
        let attachmentUrl = null;
        if (msg.attachments.size > 0) {
          attachmentUrl = msg.attachments.first().url;
        }

        evaluatedMemes.push({ ...meme, count, attachmentUrl });
      } catch (err) {
        console.error(`Skipping meme ${meme.messageId} (possibly deleted):`, err.message);
      }
    }

    if (evaluatedMemes.length === 0) {
      if (manualChannel) {
        await manualChannel.send('⚠️ All tracked memes were deleted or couldn\'t be loaded.');
      }
      saveMemes([]);
      return;
    }

    // Sort descending by reaction count
    evaluatedMemes.sort((a, b) => b.count - a.count);
    const winner = evaluatedMemes[0];

    const embed = new EmbedBuilder()
      .setTitle('😂 Meme of the Day!')
      .setDescription(`Congratulations to <@${winner.authorId}> for getting the most laughs today! 🎉\n\n[Go to Meme Message](https://discord.com/channels/${winnerChannel.guild.id}/${winner.channelId}/${winner.messageId})`)
      .addFields(
        { name: 'Posted By', value: `<@${winner.authorId}>`, inline: true },
        { name: 'Laughs', value: `😂 \`${winner.count}\``, inline: true }
      )
      .setColor('#fbc531')
      .setTimestamp();

    // Attach image preview to the embed if there is one
    if (winner.attachmentUrl) {
      embed.setImage(winner.attachmentUrl);
    } else if (winner.url) {
      embed.addFields({ name: 'Meme Content', value: winner.url });
    }

    // If it's a URL (like video), post it outside so it plays
    const contentText = winner.url && !winner.attachmentUrl 
      ? `📢 **Meme of the Day** is here! @everyone\n${winner.url}`
      : `📢 **Meme of the Day** is here! @everyone`;

    await winnerChannel.send({
      content: contentText,
      embeds: [embed]
    });

    saveMemes([]);
    
    if (manualChannel) {
      await manualChannel.send(`🏆 Success! Announced Meme of the Day by <@${winner.authorId}> with ${winner.count} reactions.`);
    }
  } catch (err) {
    console.error('Error selecting Meme of the Day:', err);
    if (manualChannel) {
      await manualChannel.send(`❌ An error occurred: ${err.message}`);
    }
  }
}

// Scheduled check to run daily at 2:00 AM local time
function runDailyScheduler() {
  const now = new Date();
  
  // Only check if it's the 2:00 AM hour (between 02:00 and 02:59)
  if (now.getHours() === 2) {
    const currentDate = now.toDateString();
    const lastRun = getLastRunDate();

    if (currentDate !== lastRun) {
      if (!lastRun) {
        saveLastRunDate(currentDate);
        return;
      }

      // Run both daily announcements
      selectAndAnnounceClipOfTheDay();
      selectAndAnnounceMemeOfTheDay();
      
      saveLastRunDate(currentDate);
    }
  }
}

client.once('ready', () => {
  console.log(`✅ Bot is online! Logged in as ${client.user.tag}`);
  console.log('🤖 Auto-Moderation, Clips, and Memes systems initialized.');
  
  // Run scheduler check immediately on boot, then every 10 minutes
  runDailyScheduler();
  setInterval(runDailyScheduler, 10 * 60 * 1000);
});

// Regex for link detection
const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/i;
// Regex to detect Discord invite links
const inviteRegex = /(discord\.(gg|io|me|li)\/([a-zA-Z0-9\-]+)|discord(app)?\.com\/invite\/([a-zA-Z0-9\-]+))/i;

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // --- ADMIN / TEST COMMANDS ---
  if (message.content.startsWith('!checkclip')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ You must be an Administrator to run this command.');
    }
    await selectAndAnnounceClipOfTheDay(message.channel);
    return;
  }

  if (message.content.startsWith('!checkmeme')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ You must be an Administrator to run this command.');
    }
    await selectAndAnnounceMemeOfTheDay(message.channel);
    return;
  }

  // --- CLIP CHANNEL AUTO-TRACKING & AUTO-REACTION ---
  if (clipsChannelId && message.channel.id === clipsChannelId) {
    if (urlRegex.test(message.content)) {
      try {
        await message.react('❤️');

        const clips = getClips();
        clips.push({
          messageId: message.id,
          channelId: message.channel.id,
          authorId: message.author.id,
          url: message.content,
          timestamp: Date.now()
        });
        saveClips(clips);
      } catch (err) {
        console.error('Failed to react/store clip:', err);
      }
    }
    return;
  }

  // --- MEME CHANNEL AUTO-TRACKING & AUTO-REACTION ---
  if (memesChannelIds.length > 0 && memesChannelIds.includes(message.channel.id)) {
    // Memes can be a link OR an uploaded image/video attachment
    if (urlRegex.test(message.content) || message.attachments.size > 0) {
      try {
        await message.react('😂');

        const memes = getMemes();
        memes.push({
          messageId: message.id,
          channelId: message.channel.id,
          authorId: message.author.id,
          url: message.content || '',
          timestamp: Date.now()
        });
        saveMemes(memes);
      } catch (err) {
        console.error('Failed to react/store meme:', err);
      }
    }
    return;
  }

  // --- READ-ONLY CHANNEL GUARD ---
  // Check by ID first, then by channel name
  const channelName = message.channel.name ? message.channel.name.toLowerCase() : '';
  const isReadOnlyChannel = readonlyChannelIds.includes(message.channel.id) ||
    channelName.includes("don't text here") ||
    channelName.includes("dont text here") ||
    channelName.includes("don-t-text-here") ||
    channelName.includes("dont-text-here") ||
    channelName.includes("no text") ||
    channelName.includes("no-text");

  if (isReadOnlyChannel) {
    try {
      await message.delete();
      const member = message.member;
      if (member && member.moderatable) {
        const oneDay = 24 * 60 * 60 * 1000;
        await member.timeout(oneDay, 'Sent a message in a read-only channel');
        const warn = await message.channel.send(
          `🔇 <@${message.author.id}> you cannot send messages in this channel! You have been timed out for **24 hours**.`
        );
        setTimeout(() => warn.delete().catch(() => {}), 10000);
      }
    } catch (err) {
      console.error('Failed to handle read-only channel message:', err);
    }
    return;
  }

  // --- 1. FILTER EXTERNAL INVITE LINKS ---
  const inviteMatch = message.content.match(inviteRegex);
  if (inviteMatch) {
    const inviteCode = inviteMatch[3] || inviteMatch[5] || '';
    
    if (!allowedInvites.includes(inviteCode)) {
      try {
        // Fetch invite metadata to see if it belongs to this server
        const invite = await client.fetchInvite(inviteCode).catch(() => null);
        
        // If it points to our server, allow it
        if (invite && invite.guild && invite.guild.id === message.guild.id) {
          return;
        }

        await message.delete();
        const warnCount = addWarning(message.author.id, message.guild.id);
        
        const warningMsg = await message.channel.send(
          `⚠️ **Advertising is not allowed!** <@${message.author.id}>, posting invite links to other Discord servers is prohibited.\n**Warning:** \`${warnCount}/3\``
        );

        setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
        await handleWarningsAndTimeout(message, warnCount);
        return;
      } catch (err) {
        console.error('Failed to handle invite link deletion:', err);
      }
    }
  }

  // --- 2. CHECK FOR +18/NSFW CONTENT IN CLEAN CHANNELS ---
  if (!message.channel.nsfw) {
    let hasExplicitContent = false;

    const explicitWords = ['porn', 'nsfw', 'hentai', 'sexy', 'sex', 'xvideos', 'xnxx', 'pornhub'];
    const lowerContent = message.content.toLowerCase();
    for (const word of explicitWords) {
      if (lowerContent.includes(word)) {
        hasExplicitContent = true;
        break;
      }
    }

    if (message.attachments.size > 0 && !hasExplicitContent) {
      const explicitExtensions = ['.exe', '.bat', '.scr'];
      message.attachments.forEach(attachment => {
        const ext = path.extname(attachment.name).toLowerCase();
        if (explicitExtensions.includes(ext)) {
          hasExplicitContent = true;
        }
      });
    }

    if (hasExplicitContent) {
      try {
        await message.delete();
        const warnCount = addWarning(message.author.id, message.guild.id);

        const warningMsg = await message.channel.send(
          `🔞 **Explicit content is not allowed!** <@${message.author.id}>, NSFW/18+ content and keywords are prohibited in this channel.\n**Warning:** \`${warnCount}/3\``
        );

        setTimeout(() => warningMsg.delete().catch(() => {}), 10000);
        await handleWarningsAndTimeout(message, warnCount);
      } catch (err) {
        console.error('Failed to handle explicit content deletion:', err);
      }
    }
  }
});

client.login(token);

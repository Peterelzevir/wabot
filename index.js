const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { proto, getContentType } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

// Bot configuration
const prefix = '.'; // Command prefix
const ownerNumber = '6281280174445'; // Developer number
const ownerName = 'elz dev'; // Developer name
let simsimi = {}; // Store SimSimi status for each group

// Store activity logs
const activityLogs = [];
const MAX_LOGS = 30; // Maximum number of logs to keep

// Log activity function
function logActivity(type, content) {
    const timestamp = new Date().toLocaleString();
    activityLogs.unshift({ type, content, timestamp });
    
    // Keep logs within limit
    if (activityLogs.length > MAX_LOGS) {
        activityLogs.pop();
    }
}

// Fancy text styles for WhatsApp
const styles = {
    title: (text) => `*『 ${text} 』*`,
    subtitle: (text) => `*乂 ${text}*`,
    list: (text) => `⌬ ${text}`,
    result: (text) => `┏⟡ *${text}*`,
    bullet: (text) => `  ✦ ${text}`,
    section: (text) => `┌──❒ ${text}`,
    item: (text) => `│ ❍ ${text}`,
    footer: (text) => `└── ${text}`,
    processing: `⟞⟦ ᴘʀᴏᴄᴇssɪɴɢ... ⟧⟝`,
    success: `✓ 𝚂𝚄𝙲𝙲𝙴𝚂𝚂`,
    error: `✗ 𝙴𝚁𝚁𝙾𝚁`,
    warn: `⚠️ 𝚆𝙰𝚁𝙽𝙸𝙽𝙶`
}

async function connectToWhatsApp() {
    // Authentication
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    // Create WhatsApp connection
    const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: 'silent' })
    });
    
    // Credentials update event
    sock.ev.on('creds.update', saveCreds);
    
    // Connection update event
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom &&
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut);
                
            console.log('Connection closed due to:', lastDisconnect.error);
            logActivity('CONNECTION', `Connection closed: ${lastDisconnect.error?.output?.payload?.message || 'Unknown error'}`);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Bot is now connected!');
            logActivity('CONNECTION', 'Bot successfully connected');
        }
    });
    
    // Messages event
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        const msg = messages[0];
        if (!msg.message) return;
        
        const msgType = Object.keys(msg.message)[0];
        const body = msgType === 'conversation' ? msg.message.conversation :
                   (msgType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '');
        
        // Extract message info
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = isGroup ? msg.key.participant : from;
        const senderName = msg.pushName || 'User';
        const quotedMsg = msgType === 'extendedTextMessage' ? msg.message.extendedTextMessage.contextInfo?.quotedMessage : null;
        const quotedSender = msgType === 'extendedTextMessage' ? msg.message.extendedTextMessage.contextInfo?.participant : null;
        const groupMetadata = isGroup ? await sock.groupMetadata(from) : null;
        const groupName = isGroup ? groupMetadata.subject : '';
        const groupMembers = isGroup ? groupMetadata.participants : [];
        const groupAdmins = isGroup ? groupMembers.filter(v => v.admin !== null).map(v => v.id) : [];
        
        // SimSimi mode check - if enabled, process all messages through SimSimi
        if (isGroup && simsimi[from] && !body.startsWith(prefix)) {
            try {
                const formData = new FormData();
                formData.append('text', body);
                formData.append('lc', 'id');
                formData.append('key', '848362ba-ce7f-4eba-b90d-c5f5f6ce999f');
                
                const simResponse = await axios.post('https://api.simsimi.vn/v1/simtalk', formData, {
                    headers: {
                        ...formData.getHeaders()
                    }
                });
                
                if (simResponse.data && simResponse.data.message) {
                    await sock.sendMessage(from, { text: simResponse.data.message }, { quoted: msg });
                    logActivity('SIMSIMI', `Response sent in ${isGroup ? groupName : 'private chat'}`);
                }
            } catch (error) {
                console.error('SimSimi error:', error);
                logActivity('ERROR', `SimSimi error: ${error.message}`);
            }
            return;
        }
        
        // Command processing
        if (!body.startsWith(prefix)) return;
        
        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        
        console.log(`Command: ${command}, Args: ${args.join(' ')}`);
        logActivity('COMMAND', `${senderName} (${sender.split('@')[0]}) used ${command} command`);
        
        // Command handler
        switch(command) {
            // Get Profile Photo
            case 'get':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Format: .get foto/info_' }, { quoted: msg });
                    break;
                }
                
                const getType = args[0].toLowerCase();
                
                if (getType === 'foto' || getType === 'photo' || getType === 'pp') {
                    await sock.sendMessage(from, { text: styles.processing + '\n_Fetching profile picture..._' }, { quoted: msg });
                    
                    try {
                        let targetJid;
                        let targetName;
                        
                        // If replying to a message, get that user's photo
                        if (quotedSender) {
                            targetJid = quotedSender;
                            
                            // Try to get user's name from group members
                            if (isGroup) {
                                const member = groupMembers.find(m => m.id === quotedSender);
                                targetName = member ? (member.notify || 'User') : 'User';
                            } else {
                                targetName = 'User';
                            }
                        } 
                        // If in group and no reply, get group photo
                        else if (isGroup) {
                            targetJid = from;
                            targetName = groupName;
                        } 
                        // If private chat, get recipient's photo
                        else {
                            targetJid = from;
                            targetName = senderName;
                        }
                        
                        // Try to get profile picture
                        try {
                            const ppUrl = await sock.profilePictureUrl(targetJid, 'image');
                            
                            await sock.sendMessage(from, { 
                                image: { url: ppUrl },
                                caption: styles.title('ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ') + '\n\n' +
                                         styles.result('𝗡𝗮𝗺𝗲') + '\n' +
                                         styles.bullet(`${targetName}`) + '\n\n' +
                                         '_Profile picture fetched successfully_ ✓'
                            }, { quoted: msg });
                            logActivity('GET', `Profile picture fetched for ${targetName}`);
                        } catch (err) {
                            // If no profile picture available
                            await sock.sendMessage(from, { 
                                text: styles.error + ' _No profile picture found_\n\n_This user/group might be using the default profile picture_ 🖼️'
                            }, { quoted: msg });
                            logActivity('GET', `No profile picture found for ${targetName}`);
                        }
                    } catch (error) {
                        console.error('Get Photo error:', error);
                        logActivity('ERROR', `Get Photo error: ${error.message}`);
                        await sock.sendMessage(from, { 
                            text: styles.error + ' _Failed to fetch profile picture_\n\n_Please try again later_ ⚠️' 
                        }, { quoted: msg });
                    }
                }
                else if (getType === 'info') {
                    await sock.sendMessage(from, { text: styles.processing + '\n_Fetching information..._' }, { quoted: msg });
                    
                    try {
                        // If in a group and no reply to a message
                        if (isGroup && !quotedSender) {
                            // Get group information
                            const infoText = styles.title('ɢʀᴏᴜᴘ ɪɴғᴏʀᴍᴀᴛɪᴏɴ') + '\n\n' +
                                             styles.result('𝗡𝗮𝗺𝗲') + '\n' +
                                             styles.bullet(`${groupName}`) + '\n\n' +
                                             styles.result('𝗜𝗗') + '\n' +
                                             styles.bullet(`${from}`) + '\n\n' +
                                             styles.result('𝗠𝗲𝗺𝗯𝗲𝗿𝘀') + '\n' +
                                             styles.bullet(`${groupMembers.length} members`) + '\n\n' +
                                             styles.result('𝗔𝗱𝗺𝗶𝗻𝘀') + '\n' +
                                             styles.bullet(`${groupAdmins.length} admins`) + '\n\n' +
                                             styles.result('𝗖𝗿𝗲𝗮𝘁𝗲𝗱') + '\n' +
                                             styles.bullet(`${new Date(groupMetadata.creation * 1000).toLocaleString()}`) + '\n\n' +
                                             '_Group information fetched successfully_ ✓';
                            
                            await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                            logActivity('GET', `Group info fetched for ${groupName}`);
                        } 
                        // If replying to a message, get that user's info
                        else if (quotedSender) {
                            // Get user info
                            let userName = 'User';
                            if (isGroup) {
                                const member = groupMembers.find(m => m.id === quotedSender);
                                userName = member ? (member.notify || 'User') : 'User';
                            }
                            
                            const userStatus = await sock.fetchStatus(quotedSender)
                                .then(status => status.status || 'No status')
                                .catch(() => 'No status');
                                
                            const infoText = styles.title('ᴜsᴇʀ ɪɴғᴏʀᴍᴀᴛɪᴏɴ') + '\n\n' +
                                             styles.result('𝗡𝗮𝗺𝗲') + '\n' +
                                             styles.bullet(`${userName}`) + '\n\n' +
                                             styles.result('𝗜𝗗') + '\n' +
                                             styles.bullet(`${quotedSender.split('@')[0]}`) + '\n\n' +
                                             styles.result('𝗦𝘁𝗮𝘁𝘂𝘀') + '\n' +
                                             styles.bullet(`${userStatus}`) + '\n\n' +
                                             styles.result('𝗥𝗼𝗹𝗲') + '\n' +
                                             styles.bullet(`${isGroup && groupAdmins.includes(quotedSender) ? 'Admin' : 'Member'}`) + '\n\n' +
                                             '_User information fetched successfully_ ✓';
                            
                            await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                            logActivity('GET', `User info fetched for ${userName}`);
                        }
                        // If in private chat
                        else {
                            const userStatus = await sock.fetchStatus(from)
                                .then(status => status.status || 'No status')
                                .catch(() => 'No status');
                                
                            const infoText = styles.title('ᴜsᴇʀ ɪɴғᴏʀᴍᴀᴛɪᴏɴ') + '\n\n' +
                                             styles.result('𝗡𝗮𝗺𝗲') + '\n' +
                                             styles.bullet(`${senderName}`) + '\n\n' +
                                             styles.result('𝗜𝗗') + '\n' +
                                             styles.bullet(`${sender.split('@')[0]}`) + '\n\n' +
                                             styles.result('𝗦𝘁𝗮𝘁𝘂𝘀') + '\n' +
                                             styles.bullet(`${userStatus}`) + '\n\n' +
                                             '_User information fetched successfully_ ✓';
                            
                            await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                            logActivity('GET', `User info fetched for ${senderName}`);
                        }
                    } catch (error) {
                        console.error('Get Info error:', error);
                        logActivity('ERROR', `Get Info error: ${error.message}`);
                        await sock.sendMessage(from, { 
                            text: styles.error + ' _Failed to fetch information_\n\n_Please try again later_ ⚠️' 
                        }, { quoted: msg });
                    }
                }
                else {
                    await sock.sendMessage(from, { text: styles.warn + ' _Available options: .get foto or .get info_' }, { quoted: msg });
                }
                break;
                
            // Image to Anime Converter
            case 'toanime':
                if (msg.message.imageMessage || 
                   (msg.message.extendedTextMessage && 
                    msg.message.extendedTextMessage.contextInfo && 
                    msg.message.extendedTextMessage.contextInfo.quotedMessage && 
                    msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage)) {
                    
                    await sock.sendMessage(from, { text: styles.processing + '\n_Converting your image to anime style..._' }, { quoted: msg });
                    
                    try {
                        // Download image
                        let imageMessage;
                        
                        if (msg.message.imageMessage) {
                            imageMessage = msg.message.imageMessage;
                        } else {
                            imageMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                        }
                        
                        const buffer = await sock.downloadMediaMessage(msg);
                        
                        // Save temporarily
                        fs.writeFileSync('./temp.jpg', buffer);
                        
                        // Upload to ImgBB or similar service first
                        const formData = new FormData();
                        formData.append('image', fs.createReadStream('./temp.jpg'));
                        
                        const imgResponse = await axios.post('https://api.imgbb.com/1/upload?key=acda84e3410cd744c9a9efeb98ebc154', formData);
                        const imageUrl = imgResponse.data.data.url;
                        
                        // Process with AI API
                        const animeResponse = await axios.get(`https://api.ryzendesu.vip/api/ai/toanime?url=${encodeURIComponent(imageUrl)}&style=anime`);
                        
                        // Send processed image
                        await sock.sendMessage(from, { 
                            image: { url: animeResponse.data.url || animeResponse.data },
                            caption: styles.title('ᴀɴɪᴍᴇ ᴄᴏɴᴠᴇʀsɪᴏɴ') + '\n\n' + styles.success + ' _Transformation completed successfully!_\n\n_Powered by AI technology_ ✨'
                        }, { quoted: msg });
                        logActivity('ANIME', `Image converted to anime style for ${senderName}`);
                        
                        // Clean up
                        fs.unlinkSync('./temp.jpg');
                    } catch (error) {
                        console.error('Image to Anime error:', error);
                        logActivity('ERROR', `Image to Anime error: ${error.message}`);
                        await sock.sendMessage(from, { text: styles.error + ' _Failed to convert image_\n\n_Please try again or use another image._ 📸' }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(from, { text: styles.warn + ' _Please send an image or reply to an image with .toanime command_' }, { quoted: msg });
                }
                break;
                
            // Mobile Legends Stats
            case 'ml':
                if (args.length < 2) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Format: .ml <userId> <zoneId>_' }, { quoted: msg });
                    break;
                }
                
                const mlUserId = args[0];
                const mlZoneId = args[1];
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Fetching Mobile Legends profile..._' }, { quoted: msg });
                
                try {
                    const mlResponse = await axios.get(`https://api.ryzendesu.vip/api/stalk/ml?userId=${mlUserId}&zoneId=${mlZoneId}`);
                    
                    if (mlResponse.data.success) {
                        const mlProfile = styles.title('ᴍᴏʙɪʟᴇ ʟᴇɢᴇɴᴅs ᴘʀᴏғɪʟᴇ') + '\n\n' +
                                          styles.result('𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲') + '\n' +
                                          styles.bullet(`${mlResponse.data.username}`) + '\n\n' +
                                          styles.result('𝗥𝗲𝗴𝗶𝗼𝗻') + '\n' +
                                          styles.bullet(`${mlResponse.data.region}`) + '\n\n' +
                                          '_Data fetched successfully_ ✓';
                                          
                        await sock.sendMessage(from, { text: mlProfile }, { quoted: msg });
                        logActivity('ML', `Mobile Legends profile fetched for ID: ${mlUserId}:${mlZoneId}`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _Profile not found_\n\n_Please check your User ID and Zone ID_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('ML Profile error:', error);
                    logActivity('ERROR', `ML Profile error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to fetch profile_\n\n_Server might be busy, please try again later_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // Free Fire Stats
            case 'ff':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Format: .ff <userId>_' }, { quoted: msg });
                    break;
                }
                
                const ffUserId = args[0];
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Fetching Free Fire profile..._' }, { quoted: msg });
                
                try {
                    const ffResponse = await axios.get(`https://api.ryzendesu.vip/api/stalk/ff?userId=${ffUserId}`);
                    
                    if (ffResponse.data) {
                        const ffData = ffResponse.data;
                        const ffProfile = styles.title('ғʀᴇᴇ ғɪʀᴇ ᴘʀᴏғɪʟᴇ') + '\n\n' +
                                          styles.subtitle('ᴘʟᴀʏᴇʀ ɪɴғᴏ') + '\n' +
                                          styles.result('𝗡𝗮𝗺𝗲') + '\n' +
                                          styles.bullet(`${ffData.name}`) + '\n\n' +
                                          styles.result('𝗕𝗶𝗼') + '\n' +
                                          styles.bullet(`${ffData.bio || '—'}`) + '\n\n' +
                                          styles.result('𝗟𝗶𝗸𝗲𝘀') + '\n' +
                                          styles.bullet(`${ffData.like} ❤️`) + '\n\n' +
                                          styles.result('𝗟𝗲𝘃𝗲𝗹') + '\n' +
                                          styles.bullet(`${ffData.level} (${ffData.exp} XP)`) + '\n\n' +
                                          styles.result('𝗥𝗲𝗴𝗶𝗼𝗻') + '\n' +
                                          styles.bullet(`${ffData.region}`) + '\n\n' +
                                          styles.result('𝗥𝗮𝗻𝗸') + '\n' +
                                          styles.bullet(`${ffData.brRank} (${ffData.brRankPoint} pts)`) + '\n\n' +
                                          styles.subtitle('ᴀᴄᴄᴏᴜɴᴛ ᴅᴇᴛᴀɪʟs') + '\n' +
                                          styles.result('𝗖𝗿𝗲𝗮𝘁𝗲𝗱') + '\n' +
                                          styles.bullet(`${ffData.accountCreated}`) + '\n\n' +
                                          styles.result('𝗟𝗮𝘀𝘁 𝗟𝗼𝗴𝗶𝗻') + '\n' +
                                          styles.bullet(`${ffData.lastLogin}`) + '\n\n' +
                                          styles.subtitle('ᴘᴇᴛ ɪɴғᴏʀᴍᴀᴛɪᴏɴ') + '\n' +
                                          styles.bullet(`${ffData.petInformation.name} (Level ${ffData.petInformation.level})`);
                        
                        // Get the first equipped item's image as profile picture
                        const profileImg = ffData.equippedItems && ffData.equippedItems.length > 0 
                            ? ffData.equippedItems[0].img 
                            : null;
                        
                        if (profileImg) {
                            await sock.sendMessage(from, { 
                                image: { url: profileImg },
                                caption: ffProfile
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: ffProfile }, { quoted: msg });
                        }
                        logActivity('FF', `Free Fire profile fetched for ID: ${ffUserId}`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _Profile not found_\n\n_Check your ID and try again_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('FF Profile error:', error);
                    logActivity('ERROR', `FF Profile error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to fetch profile_\n\n_Server might be busy, please try again later_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // TikTok Profile
            case 'tt':
            case 'tiktok':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Format: .tt <username>_' }, { quoted: msg });
                    break;
                }
                
                const ttUsername = args[0];
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Fetching TikTok profile..._' }, { quoted: msg });
                
                try {
                    const ttResponse = await axios.get(`https://api.ryzendesu.vip/api/stalk/tiktok?username=${ttUsername}`);
                    
                    if (ttResponse.data && ttResponse.data.userInfo) {
                        const ttData = ttResponse.data.userInfo;
                        const ttProfile = styles.title('ᴛɪᴋᴛᴏᴋ ᴘʀᴏғɪʟᴇ') + '\n\n' +
                                          styles.result('𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲') + '\n' +
                                          styles.bullet(`@${ttData.username}`) + '\n\n' +
                                          styles.result('𝗡𝗮𝗺𝗲') + '\n' +
                                          styles.bullet(`${ttData.name}`) + '\n\n' +
                                          styles.result('𝗕𝗶𝗼') + '\n' +
                                          styles.bullet(`${ttData.bio || '—'}`) + '\n\n' +
                                          styles.result('𝗩𝗲𝗿𝗶𝗳𝗶𝗲𝗱') + '\n' +
                                          styles.bullet(`${ttData.verified ? 'Yes ✓' : 'No ✗'}`) + '\n\n' +
                                          styles.subtitle('sᴛᴀᴛɪsᴛɪᴄs') + '\n' +
                                          styles.bullet(`Followers: ${ttData.totalFollowers.toLocaleString()}`) + '\n' +
                                          styles.bullet(`Following: ${ttData.totalFollowing.toLocaleString()}`) + '\n' +
                                          styles.bullet(`Likes: ${ttData.totalLikes.toLocaleString()}`) + '\n' +
                                          styles.bullet(`Videos: ${ttData.totalVideos.toLocaleString()}`) + '\n\n' +
                                          '_Profile fetched successfully_ ✓';
                        
                        await sock.sendMessage(from, { 
                            image: { url: ttData.avatar },
                            caption: ttProfile
                        }, { quoted: msg });
                        logActivity('TIKTOK', `TikTok profile fetched for @${ttUsername}`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _Profile not found_\n\n_Check the username and try again_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('TikTok Profile error:', error);
                    logActivity('ERROR', `TikTok Profile error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to fetch TikTok profile_\n\n_The username might be invalid or server is busy_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // AI - Deepseek
            case 'deepseek':
            case 'ds':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Please provide a prompt for Deepseek AI_' }, { quoted: msg });
                    break;
                }
                
                const dsPrompt = args.join(' ');
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Asking Deepseek AI..._' }, { quoted: msg });
                
                try {
                    const dsResponse = await axios.get(`https://api.ryzendesu.vip/api/ai/deepseek?text=${encodeURIComponent(dsPrompt)}`);
                    
                    if (dsResponse.data && dsResponse.data.status && dsResponse.data.answer) {
                        const aiResponse = styles.title('ᴅᴇᴇᴘsᴇᴇᴋ ᴀɪ') + '\n\n' +
                                          styles.subtitle('ʏᴏᴜʀ ǫᴜᴇsᴛɪᴏɴ') + '\n' +
                                          styles.bullet(`"${dsPrompt}"`) + '\n\n' +
                                          styles.subtitle('ᴀɪ ʀᴇsᴘᴏɴsᴇ') + '\n' +
                                          `${dsResponse.data.answer}`;
                        
                        await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
                        logActivity('AI', `Deepseek AI query processed: "${dsPrompt.substring(0, 30)}..."`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No response from AI_\n\n_Please try again with a different prompt_ 🤖' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('Deepseek AI error:', error);
                    logActivity('ERROR', `Deepseek AI error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to get AI response_\n\n_The AI service might be busy, please try again later_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // AI - Qwen
            case 'qwen':
            case 'qw':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Please provide a prompt for Qwen AI_' }, { quoted: msg });
                    break;
                }
                
                const qwPrompt = args.join(' ');
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Asking Qwen AI..._' }, { quoted: msg });
                
                try {
                    const qwResponse = await axios.get(`https://api.ryzendesu.vip/api/ai/qwen?text=${encodeURIComponent(qwPrompt)}`);
                    
                    if (qwResponse.data && qwResponse.data.success && qwResponse.data.answer) {
                        const aiResponse = styles.title('ǫᴡᴇɴ ᴀɪ') + '\n\n' +
                                          styles.subtitle('ʏᴏᴜʀ ǫᴜᴇsᴛɪᴏɴ') + '\n' +
                                          styles.bullet(`"${qwPrompt}"`) + '\n\n' +
                                          styles.subtitle('ᴀɪ ʀᴇsᴘᴏɴsᴇ') + '\n' +
                                          `${qwResponse.data.answer}`;
                        
                        await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
                        logActivity('AI', `Qwen AI query processed: "${qwPrompt.substring(0, 30)}..."`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No response from AI_\n\n_Please try again with a different prompt_ 🤖' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('Qwen AI error:', error);
                    logActivity('ERROR', `Qwen AI error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to get AI response_\n\n_The AI service might be busy, please try again later_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // AI - ChatGPT
            case 'chatgpt':
            case 'gpt':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Please provide a prompt for ChatGPT_' }, { quoted: msg });
                    break;
                }
                
                const gptPrompt = args.join(' ');
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Asking ChatGPT..._' }, { quoted: msg });
                
                try {
                    const gptResponse = await axios.get(`https://api.ryzendesu.vip/api/ai/chatgpt?text=${encodeURIComponent(gptPrompt)}`);
                    
                    if (gptResponse.data && gptResponse.data.success && gptResponse.data.result) {
                        const aiResponse = styles.title('ᴄʜᴀᴛɢᴘᴛ') + '\n\n' +
                                          styles.subtitle('ʏᴏᴜʀ ǫᴜᴇsᴛɪᴏɴ') + '\n' +
                                          styles.bullet(`"${gptPrompt}"`) + '\n\n' +
                                          styles.subtitle('ᴀɪ ʀᴇsᴘᴏɴsᴇ') + '\n' +
                                          `${gptResponse.data.result}`;
                        
                        await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
                        logActivity('AI', `ChatGPT query processed: "${gptPrompt.substring(0, 30)}..."`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No response from ChatGPT_\n\n_Please try again with a different prompt_ 🤖' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('ChatGPT error:', error);
                    logActivity('ERROR', `ChatGPT error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to get ChatGPT response_\n\n_The AI service might be busy, please try again later_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // Google Search
            case 'google':
            case 'search':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Please provide a search query_' }, { quoted: msg });
                    break;
                }
                
                const searchQuery = args.join(' ');
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Searching Google..._' }, { quoted: msg });
                
                try {
                    const searchResponse = await axios.get(`https://api.ryzendesu.vip/api/search/google?query=${encodeURIComponent(searchQuery)}`);
                    
                    if (searchResponse.data && searchResponse.data.length > 0) {
                        let searchResults = styles.title('ɢᴏᴏɢʟᴇ sᴇᴀʀᴄʜ ʀᴇsᴜʟᴛs') + '\n\n' +
                                           styles.subtitle(`ᴏ̨ᴜᴇʀʏ: "${searchQuery}"`) + '\n\n';
                        
                        // Limit to 5 results to avoid long messages
                        const results = searchResponse.data.slice(0, 5);
                        
                        results.forEach((result, index) => {
                            searchResults += styles.result(`${index + 1}. ${result.title}`) + '\n';
                            searchResults += styles.bullet(`${result.description}`) + '\n';
                            searchResults += styles.bullet(`🔗 ${result.link}`) + '\n\n';
                        });
                        
                        searchResults += '_Search completed successfully_ ✓';
                        
                        await sock.sendMessage(from, { text: searchResults }, { quoted: msg });
                        logActivity('SEARCH', `Google search query: "${searchQuery}"`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No search results found_\n\n_Try with different keywords_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('Google Search error:', error);
                    logActivity('ERROR', `Google Search error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to search_\n\n_Google service might be busy, please try again later_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // SimSimi On/Off
            case 'simsimi':
            case 'sim':
                if (!isGroup) {
                    await sock.sendMessage(from, { text: styles.warn + ' _SimSimi can only be used in groups_' }, { quoted: msg });
                    break;
                }
                
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Format: .sim on/off_' }, { quoted: msg });
                    break;
                }
                
                const simCommand = args[0].toLowerCase();
                
                if (simCommand === 'on') {
                    simsimi[from] = true;
                    await sock.sendMessage(from, { text: styles.success + ' _SimSimi has been activated in this group!_\n\n_All messages will now get a response_ 🤖' }, { quoted: msg });
                    logActivity('SIMSIMI', `SimSimi activated in ${groupName}`);
                } else if (simCommand === 'off') {
                    simsimi[from] = false;
                    await sock.sendMessage(from, { text: styles.success + ' _SimSimi has been deactivated in this group_' }, { quoted: msg });
                    logActivity('SIMSIMI', `SimSimi deactivated in ${groupName}`);
                } else {
                    await sock.sendMessage(from, { text: styles.error + ' _Invalid option_\n\n_Use .sim on or .sim off_ ⚠️' }, { quoted: msg });
                }
                break;
                
            // Cryptocurrency Price Check
            case 'cek':
            case 'crypto':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Format: .crypto <symbol/name>_' }, { quoted: msg });
                    break;
                }
                
                const cryptoQuery = args.join(' ').toLowerCase();
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Checking cryptocurrency price..._' }, { quoted: msg });
                
                try {
                    // Call CoinGecko API to search for the crypto
                    const searchResponse = await axios.get(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(cryptoQuery)}`);
                    
                    if (searchResponse.data && searchResponse.data.coins && searchResponse.data.coins.length > 0) {
                        // Get the first (most relevant) result
                        const coin = searchResponse.data.coins[0];
                        
                        // Get detailed price data for the coin
                        const priceResponse = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd,idr&include_24hr_change=true`);
                        
                        if (priceResponse.data && priceResponse.data[coin.id]) {
                            const priceData = priceResponse.data[coin.id];
                            const usdPrice = priceData.usd;
                            const idrPrice = priceData.idr;
                            const change24h = priceData.usd_24h_change ? priceData.usd_24h_change.toFixed(2) : 'N/A';
                            const changeIcon = priceData.usd_24h_change >= 0 ? '↗️' : '↘️';
                            
                            const cryptoInfo = styles.title('ᴄʀʏᴘᴛᴏᴄᴜʀʀᴇɴᴄʏ ᴘʀɪᴄᴇ') + '\n\n' +
                                             styles.result('𝗖𝗼𝗶𝗻') + '\n' +
                                             styles.bullet(`${coin.name} (${coin.symbol.toUpperCase()})`) + '\n\n' +
                                             styles.result('𝗣𝗿𝗶𝗰𝗲') + '\n' +
                                             styles.bullet(`USD: $${usdPrice.toLocaleString()}`) + '\n' +
                                             styles.bullet(`IDR: Rp${idrPrice.toLocaleString()}`) + '\n\n' +
                                             styles.result('𝟮𝟰𝗵 𝗖𝗵𝗮𝗻𝗴𝗲') + '\n' +
                                             styles.bullet(`${change24h}% ${changeIcon}`) + '\n\n' +
                                             '_Data from CoinGecko_ ✓';
                            
                            await sock.sendMessage(from, { text: cryptoInfo }, { quoted: msg });
                            logActivity('CRYPTO', `Cryptocurrency price checked for ${coin.name}`);
                        } else {
                            await sock.sendMessage(from, { text: styles.error + ' _Failed to fetch price data_\n\n_Please try again later_ ⚠️' }, { quoted: msg });
                        }
                    } else {
                        // If no exact match found, suggest possible coins
                        await sock.sendMessage(from, { 
                            text: styles.error + ` _No cryptocurrency found with name/symbol "${cryptoQuery}"_\n\n` +
                                  styles.subtitle('ᴘᴏssɪʙʟᴇ ᴍᴀᴛᴄʜᴇs') + '\n' +
                                  (searchResponse.data.coins.length > 0 ? 
                                      searchResponse.data.coins.slice(0, 3).map((c, i) => 
                                          styles.bullet(`${c.name} (${c.symbol.toUpperCase()})`)
                                      ).join('\n') : 
                                      styles.bullet('No suggestions found')) + '\n\n' +
                                  '_Try using the exact name or symbol_ 🔍'
                        }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('Crypto price error:', error);
                    logActivity('ERROR', `Crypto price error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to check cryptocurrency price_\n\n_The service might be busy, please try again later_ ⚠️' }, { quoted: msg });
                }
                break;

            // YouTube Transcript
            case 'transcript':
            case 'tr':
                if (args.length < 1) {
                    await sock.sendMessage(from, { text: styles.warn + ' _Format: .transcript <YouTube URL>_' }, { quoted: msg });
                    break;
                }
                
                const youtubeUrl = args[0];
                
                // Basic URL validation
                if (!youtubeUrl.includes('youtube.com/') && !youtubeUrl.includes('youtu.be/')) {
                    await sock.sendMessage(from, { text: styles.error + ' _Invalid YouTube URL_\n\n_Please provide a valid YouTube video link_ 🔍' }, { quoted: msg });
                    break;
                }
                
                await sock.sendMessage(from, { text: styles.processing + '\n_Fetching video transcript..._' }, { quoted: msg });
                
                try {
                    const transcriptResponse = await axios.get(`https://api.ryzendesu.vip/api/tool/yt-transcript?url=${encodeURIComponent(youtubeUrl)}`);
                    
                    if (transcriptResponse.data && transcriptResponse.data.status && transcriptResponse.data.transcript) {
                        // Get video title if possible
                        let videoTitle = '';
                        try {
                            const videoInfoResponse = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`);
                            if (videoInfoResponse.data && videoInfoResponse.data.title) {
                                videoTitle = videoInfoResponse.data.title;
                            }
                        } catch (error) {
                            // If we can't get the title, just continue without it
                            console.error('YouTube title fetch error:', error);
                        }
                        
                        // Clean up and format the transcript
                        let transcript = transcriptResponse.data.transcript.trim();
                        
                        // Limit length to avoid message issues
                        const maxLength = 3500;
                        let isTruncated = false;
                        
                        if (transcript.length > maxLength) {
                            transcript = transcript.substring(0, maxLength);
                            isTruncated = true;
                            
                            // Try to find the last complete sentence
                            const lastPeriod = transcript.lastIndexOf('.');
                            const lastNewline = transcript.lastIndexOf('\n');
                            const lastBreakpoint = Math.max(lastPeriod, lastNewline);
                            
                            if (lastBreakpoint > maxLength * 0.8) {
                                transcript = transcript.substring(0, lastBreakpoint + 1);
                            }
                        }
                        
                        const formattedTranscript = styles.title('ʏᴏᴜᴛᴜʙᴇ ᴛʀᴀɴsᴄʀɪᴘᴛ') + '\n\n' +
                                                 (videoTitle ? styles.subtitle('ᴠɪᴅᴇᴏ ᴛɪᴛʟᴇ') + '\n' + 
                                                 styles.bullet(`${videoTitle}`) + '\n\n' : '') +
                                                 styles.subtitle('ᴛʀᴀɴsᴄʀɪᴘᴛ') + '\n' +
                                                 transcript + 
                                                 (isTruncated ? '\n\n' + styles.warn + ' _Transcript truncated due to length..._' : '') + '\n\n' +
                                                 '_Transcript fetched successfully_ ✓';
                        
                        await sock.sendMessage(from, { text: formattedTranscript }, { quoted: msg });
                        logActivity('TRANSCRIPT', `YouTube transcript fetched for video: ${videoTitle || youtubeUrl}`);
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No transcript available for this video_\n\n_The video might not have captions or subtitles_ 📝' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('YouTube transcript error:', error);
                    logActivity('ERROR', `YouTube transcript error: ${error.message}`);
                    await sock.sendMessage(from, { text: styles.error + ' _Failed to fetch transcript_\n\n_The service might be busy or the video doesn\'t have captions_ ⚠️' }, { quoted: msg });
                }
                break;

            // View Bot Logs
            case 'logs':
                // Check if sender is the bot owner
                if (sender !== ownerNumber + '@s.whatsapp.net') {
                    await sock.sendMessage(from, { text: styles.error + ' _Only the bot owner can view logs_' }, { quoted: msg });
                    break;
                }
                
                const logEntries = activityLogs.slice(0, 15); // Show last 15 logs
                let logText = styles.title('ʙᴏᴛ ᴀᴄᴛɪᴠɪᴛʏ ʟᴏɢs') + '\n\n';
                
                if (logEntries.length === 0) {
                    logText += styles.bullet('No recent activity logs.');
                } else {
                    logEntries.forEach((log, index) => {
                        logText += styles.result(`${index + 1}. [${log.type}]`) + '\n';
                        logText += styles.bullet(`${log.timestamp}: ${log.content}`) + '\n\n';
                    });
                }
                
                logText += styles.footer('End of logs');
                
                await sock.sendMessage(from, { text: logText }, { quoted: msg });
                break;
                
            // Developer contact
            case 'dev':
            case 'owner':
                // Send contact card for developer
                const vcard = 'BEGIN:VCARD\n' +
                              'VERSION:3.0\n' +
                              `FN:${ownerName}\n` +
                              `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}\n` +
                              'END:VCARD';
                
                await sock.sendMessage(from, { 
                    contacts: { 
                        displayName: ownerName, 
                        contacts: [{ vcard }] 
                    },
                    caption: styles.title('ᴅᴇᴠᴇʟᴏᴘᴇʀ ᴄᴏɴᴛᴀᴄᴛ') + '\n\n_Contact saved as "elz dev"_\n\n_For issues, requests or collaborations_ ✨'
                }, { quoted: msg });
                logActivity('DEV', `Developer contact shared with ${senderName}`);
                break;
                
            // Help command
            case 'help':
            case 'menu':
                const helpText = styles.title('ʀʏᴢᴇɴ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ ᴍᴇɴᴜ') + '\n\n' +
                               styles.section('𝗔𝗜 & 𝗜𝗺𝗮𝗴𝗲 𝗙𝗲𝗮𝘁𝘂𝗿𝗲𝘀') + '\n' +
                               styles.item('*.toanime* - Convert image to anime style') + '\n' +
                               styles.item('*.ds <prompt>* - Ask Deepseek AI') + '\n' +
                               styles.item('*.qw <prompt>* - Ask Qwen AI') + '\n' +
                               styles.item('*.gpt <prompt>* - Ask ChatGPT') + '\n\n' +
                               
                               styles.section('𝗦𝘁𝗮𝗹𝗸𝗶𝗻𝗴 𝗧𝗼𝗼𝗹𝘀') + '\n' +
                               styles.item('*.ml <userId> <zoneId>* - Mobile Legends profile') + '\n' +
                               styles.item('*.ff <userId>* - Free Fire profile') + '\n' +
                               styles.item('*.tt <username>* - TikTok profile lookup') + '\n\n' +
                               
                               styles.section('𝗨𝘁𝗶𝗹𝗶𝘁𝘆 𝗙𝗲𝗮𝘁𝘂𝗿𝗲𝘀') + '\n' +
                               styles.item('*.search <query>* - Google search') + '\n' +
                               styles.item('*.sim on/off* - Toggle SimSimi chat in groups') + '\n' +
                               styles.item('*.crypto <symbol>* - Check cryptocurrency price') + '\n' +
                               styles.item('*.tr <youtube-url>* - Get YouTube transcript') + '\n' +
                               styles.item('*.get foto* - Get profile picture') + '\n' +
                               styles.item('*.get info* - Get user/group info') + '\n\n' +
                               
                               styles.section('𝗢𝘄𝗻𝗲𝗿 𝗖𝗼𝗺𝗺𝗮𝗻𝗱𝘀') + '\n' +
                               styles.item('*.logs* - View bot activity logs') + '\n' +
                               styles.item('*.dev* - Developer contact') + '\n\n' +
                               
                               styles.section('𝗕𝗼𝘁 𝗦𝘁𝗮𝘁𝘂𝘀') + '\n' +
                               styles.item(`Runtime: ${formatUptime(process.uptime())}`) + '\n' +
                               styles.item(`Prefix: ${prefix}`) + '\n' +
                               styles.footer('create by elz');
                
                // Menu image URL - you can replace this with your own bot logo/image
                const menuImageUrl = 'https://i.ibb.co.com/cctMqDP4/IMG-20250219-123928-101.jpg';
                
                try {
                    // Send menu as image with caption
                    await sock.sendMessage(from, { 
                        image: { url: menuImageUrl },
                        caption: helpText
                    }, { quoted: msg });
                    logActivity('HELP', `Help menu displayed with image for ${senderName}`);
                } catch (error) {
                    // Fallback to text-only if image fails
                    console.error('Menu image error:', error);
                    await sock.sendMessage(from, { text: helpText }, { quoted: msg });
                    logActivity('HELP', `Help menu displayed (text-only) for ${senderName} due to image error`);
                }
                break;
                
            default:
                // Unknown command
                break;
        }
    });
    
    return sock;
}

// Helper function to format uptime
function formatUptime(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

// Start the bot
connectToWhatsApp();

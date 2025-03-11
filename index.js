const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { proto, getContentType } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

// Bot configuration
const prefix = '.'; // Command prefix
const ownerNumber = '6281280174445'; // Developer number
const ownerName = 'elz dev'; // Developer name
let simsimi = {}; // Store SimSimi status for each group

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
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Bot is now connected!');
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
                }
            } catch (error) {
                console.error('SimSimi error:', error);
            }
            return;
        }
        
        // Command processing
        if (!body.startsWith(prefix)) return;
        
        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        
        console.log(`Command: ${command}, Args: ${args.join(' ')}`);
        
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
                        } catch (err) {
                            // If no profile picture available
                            await sock.sendMessage(from, { 
                                text: styles.error + ' _No profile picture found_\n\n_This user/group might be using the default profile picture_ 🖼️'
                            }, { quoted: msg });
                        }
                    } catch (error) {
                        console.error('Get Photo error:', error);
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
                        }
                    } catch (error) {
                        console.error('Get Info error:', error);
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
                        
                        // Clean up
                        fs.unlinkSync('./temp.jpg');
                    } catch (error) {
                        console.error('Image to Anime error:', error);
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
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _Profile not found_\n\n_Please check your User ID and Zone ID_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('ML Profile error:', error);
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
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _Profile not found_\n\n_Check your ID and try again_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('FF Profile error:', error);
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
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _Profile not found_\n\n_Check the username and try again_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('TikTok Profile error:', error);
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
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No response from AI_\n\n_Please try again with a different prompt_ 🤖' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('Deepseek AI error:', error);
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
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No response from AI_\n\n_Please try again with a different prompt_ 🤖' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('Qwen AI error:', error);
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
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No response from ChatGPT_\n\n_Please try again with a different prompt_ 🤖' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('ChatGPT error:', error);
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
                    } else {
                        await sock.sendMessage(from, { text: styles.error + ' _No search results found_\n\n_Try with different keywords_ 🔍' }, { quoted: msg });
                    }
                } catch (error) {
                    console.error('Google Search error:', error);
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
                } else if (simCommand === 'off') {
                    simsimi[from] = false;
                    await sock.sendMessage(from, { text: styles.success + ' _SimSimi has been deactivated in this group_' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: styles.error + ' _Invalid option_\n\n_Use .sim on or .sim off_ ⚠️' }, { quoted: msg });
                }
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
                               styles.item('*.get foto* - Get profile picture') + '\n' +
                               styles.item('*.get info* - Get user/group info') + '\n' +
                               styles.item('*.dev* - Developer contact') + '\n\n' +
                               
                               styles.section('𝗕𝗼𝘁 𝗦𝘁𝗮𝘁𝘂𝘀') + '\n' +
                               styles.item(`Runtime: ${formatUptime(process.uptime())}`) + '\n' +
                               styles.item(`Prefix: ${prefix}`) + '\n' +
                               styles.footer('Created with ♥ by elz');
                
                await sock.sendMessage(from, { text: helpText }, { quoted: msg });
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

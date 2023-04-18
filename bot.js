const Slack = require('@slack/bolt');
const Eris = require("eris");
const request = require('request');
const util = require('util');

// Init Slack first
const slackKey = require('./slack.keys.js');
const slackApp = new Slack.App({
    token: slackKey.bot_token,
    appToken: slackKey.app_token,
    signingSecret: slackKey.signing_secret,
    logLevel: Slack.LogLevel.ERROR,
    socketMode: true
});
let slackChannel;

const discordKey = require('./discord.keys.js');
const discordBot = new Eris(discordKey.bot_token);

const debugLogging = process.argv.indexOf('-v') >= 0;

function log(message, pre, level=0) {
    if (level == 0 || debugLogging) {
        console.log(`[${pre}]${'\t'}${message}`);
    }
}

function start() {
    slackApp.start().then(() => {
        log(`Logged in OK`, 'slack');
    });

    discordBot.connect();
    discordBot.on('ready',  () => {
        log('Logged in OK', 'discord');
    });
}

async function forwardMessageToSlack(discordMessage) {
    let displayName = (discordMessage.member && discordMessage.member.nick) ? discordMessage.member.nick : discordMessage.author.username;
    log(`displayName: ${displayName}`, 'discord', 3);
    let avatarURL = discordMessage.author.avatarURL.replace(/\.webp.*$/i, ".png"); // Might not work for users with default avatar
    log(`avatarURL: ${avatarURL}`, 'discord', 3);

    let content = discordMessage.content || "";

    // check for attachments
    if (discordMessage.attachments.length > 0) {
        for (let attachment of discordMessage.attachments) {
            if (attachment.url) {
                content += `\n${attachment.url}`;
            }
        }
    }

    if (content.length === 0) {
        log(`No content to forward for ${displayName}`, 'discord', 3);
        return;
    }

    const data = {
        text: content,
        username: displayName,
        icon_url: avatarURL
    }

    log(`data: ${JSON.stringify(data,null,3)}`, 'discord', 3);

    try {
        const response = await request({
            url: slackKey.hook_url,
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            json: data
        });
        log(`Slack response: ${response.body}`, 'discord', 3);
    } catch (err) {
        log(`Error when posting to Slack: ${err}`, 'discord');
    }
}

const slack_profiles_cache = {}

async function normaliseSlackMessage(slackMessage) {
    const channelRegex = /<#(?:.+?)\|([a-z0-9_-]+)>/g;
    const usernameRegex = /<@(.+?)>/g;

    // channel names can't contain [&<>]
    let cleanText = slackMessage.text.replace(channelRegex, "#$1");
    
    const userMatches = [];
    let match;
    while ((match = usernameRegex.exec(cleanText)) != null) {
        userMatches.push(match);
    }
    // Matches is array of ["<@userid>", "userid"]
    // We want to map to array of {match: ["<@userid>", "userid"], name: "user name"}
    
    const matchPromises = [];
    for (let userMatch of userMatches) {
        matchPromises.push(resolveSlackUserReplacement(userMatch));
    }
    try {
        const userReplacements = await Promise.all(matchPromises);
        log(`replacements: ${JSON.stringify(userReplacements, null, 3)}`, 'slack', 3);
        for (let replacement of userReplacements) {
            cleanText = cleanText.replace(replacement.match[0], `@${replacement.username}`);
        }

        cleanText = cleanText.replace(/&gt;/g, ">")
                             .replace(/&lt;/g, "<")
                             .replace(/&amp;/g, "&");
        return cleanText;
    } catch (err) {
        throw err;
    }
}

async function resolveSlackUserReplacement(match) {
    try {
        const profile = await fetchSlackProfile(match[1]);
        return {
            match: match,
            username: profile.username
        };
    } catch (err) {
        throw err;
    }
}

async function fetchSlackProfile(user) {
    if (user in slack_profiles_cache) {
        log(`Profile '${slack_profiles_cache[user].username}' (${user}) already in cache`, 'slack', 3);
        return slack_profiles_cache[user];
    }
    else {
        //not in our cache
        log(`Fetching profile for uncached ID ${user}...`, 'slack', 3);
        try {
            const res = await slackApp.client.users.info({ user: user });
            if (res.ok) {
                const cached_profile = {
                    username: res.user.profile.display_name_normalized || res.user.profile.real_name_normalized,
                    avatar_url: res.user.profile.image_192,
                }
                log(`Profile received for ${cached_profile.username}`, 'slack', 3);
                slack_profiles_cache[user] = cached_profile;
                return cached_profile;
            } else {
                throw new Error(`Error fetching profile for user ${user}: ${res.error}`);
            }
        } catch (err) {
            throw new Error(`Error fetching profile for user ${user}: ${err}`);
        }
    }
}

async function fetchSlackFile(fileId) {
    try {
        // const fileInfo = await slackApp.client.files.info({ file: fileId });
        // if (!fileInfo.ok) {
        //     throw new Error(`Error fetching file ${fileId}: ${fileInfo.error}`);
        // }
        const filePublic = await slackApp.client.files.sharedPublicURL({
            token: slackKey.user_token,
            file: fileId
        });
        if (!filePublic.ok) {
            throw new Error(`Error fetching file ${fileId}: ${filePublic.error}`);
        }
        return filePublic.file;
    } catch (err) {
        throw new Error(`Error fetching file ${fileId}: ${err}`);
    }
}

async function forwardMessageToDiscord(slackMessage) {
    log(JSON.stringify(slackMessage, null, 3), 'slack', 3);

    let filePromises = [];

    if (slackMessage.files && slackMessage.files.length > 0) {
        for (let file of slackMessage.files) {
            if (file.id) {
                filePromises.push(fetchSlackFile(file.id));
            }
        }
    }

    const promises = [fetchSlackProfile(slackMessage.user), normaliseSlackMessage(slackMessage), Promise.all(filePromises)];
    try {
        let [fetched_profile, content, attachments] = await Promise.all(promises);

        if (attachments && attachments.length > 0) {
            for (let attachment of attachments) {
                if (attachment.permalink_public) {
                    content += `\n${attachment.permalink_public}`;
                }
            }
        }
    
        if (content.length === 0) {
            log(`No content to forward for ${fetched_profile.username}`, 'slack', 3);
            return;
        }
    
        let options = {
            'content': content,
            'username': fetched_profile.username,
            'avatarURL': fetched_profile.avatar_url,
        };
        discordBot.executeWebhook(discordKey.hook_id, discordKey.hook_token, options);
    } catch (err) {
        log(`Error while forwarding to Discord: ${err}`, 'slack', 0)
    }
}

/*************************************************************/

slackApp.event('message', async ({ event, context }) => {
    if (event.user && event.channel == slackKey.channel_id) {
        await forwardMessageToDiscord(event);
    }
    else {
        //No user id => author is probably a webhook
    }
});

slackApp.event('user_change', async ({ event, context }) => {
    const updated_profile = {
        username: event.user.profile.display_name_normalized || event.user.profile.real_name_normalized,
        avatar_url: event.user.profile.image_192
    }
    log(`USER_CHANGE event for ${updated_profile.username}`, 'slack', 2);
    slack_profiles_cache[event.user.profile.id] = updated_profile;
});

discordBot.on('messageCreate', async (msg) => {
    if (msg.channel.id === discordKey.channel_id && msg.author.id !== discordKey.hook_id) {
        await forwardMessageToSlack(msg);
    }
});

start();

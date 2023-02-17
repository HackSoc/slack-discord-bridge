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
    if(level == 0 || debugLogging) {
        console.log(`[${pre}]${'\t'}${message}`);
    }
}

function start() {
    log(`Logging in Slack with channel ${slackKey.channel_name}`, 'slack', 2);
    slackApp.start().then(() => {
        // Get the channel ID
        slackApp.client.conversations.list().then(res => {
            for(let channel of res.channels) {
                if(channel.name == slackKey.channel_name) {
                    slackChannel = channel.id;
                    log(`Logged in OK`, 'slack');
                    break;
                }
            }
            if(!slackChannel) {
                log(`Channel ${slackKey.channel_name} not found`, 'slack');
                process.exit(6);
            }
        });
    });

    log(`Logging in Discord with channel ${discordKey.channel_name}`, 'discord', 2);
    discordBot.connect();
    discordBot.on('ready',  () => {
        log('Logged in OK', 'discord');
    });
}

function forwardMessageToSlack(discordMessage) {
    let displayName = (discordMessage.member && discordMessage.member.nick) ? discordMessage.member.nick : discordMessage.author.username;
    log(`displayName: ${displayName}`, 'discord', 3);
    let avatarURL = discordMessage.author.avatarURL.replace(/\.webp.*$/i, ".png"); // Might not work for users with default avatar
    log(`avatarURL: ${avatarURL}`, 'discord', 3);

    let content = discordMessage.content || "";

    // check for attachments
    if(discordMessage.attachments.length > 0) {
        for(let attachment of discordMessage.attachments) {
            if(attachment.url) {
                content += `\n${attachment.url}`;
            }
        }
    }

    const data = {
        text: content,
        username: displayName,
        icon_url: avatarURL
    }

    log(`data: ${JSON.stringify(data,null,3)}`, 'discord', 3);

    request({
        url: slackKey.hook_url,
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        json: data
    }, (err, res, body) => {
        if(err) {
            log(`Error when posting to Slack: ${err}`, 'discord');
        }
        else {
            //we good
            log(`Slack response: ${body}`, 'discord', 3);
        }
    })
}

const slack_profiles_cache = {}

function normaliseSlackMessage(slackMessage) {
    return new Promise((resolve, reject) => {
        const channelRegex = /<#(?:.+?)\|([a-z0-9_-]+)>/g;
        const usernameRegex = /<@(.+?)>/g;
    
        // channel names can't contain [&<>]
        let cleanText = slackMessage.text.replace(channelRegex, "#$1");
        
        const userMatches = [];
        let match;
        while((match = usernameRegex.exec(cleanText)) != null) {
            userMatches.push(match);
        }
        // Matches is array of ["<@userid>", "userid"]
        // We want to map to array of {match: ["<@userid>", "userid"], name: "user name"}
        
        const matchPromises = [];
        for(let userMatch of userMatches) {
            matchPromises.push(resolveSlackUserReplacement(userMatch));
        }
        Promise.all(matchPromises).then(userReplacements => {
            log(`replacements: ${JSON.stringify(userReplacements,null,3)}`, 'slack', 3);
            for(let replacement of userReplacements) {
                cleanText = cleanText.replace(replacement.match[0], `@${replacement.username}`);
            }

            // /g is important.
            cleanText = cleanText.replace(/&gt;/g,">")
                                 .replace(/&lt;/g,"<")
                                 .replace(/&amp;/g, "&");
            resolve(cleanText);
        }).catch(err => {reject(err)});
    });
}

function resolveSlackUserReplacement(match) {
    return new Promise((resolve, reject) => {
        fetchSlackProfile(match[1]).then(profile => {
            resolve({
                match: match,
                username: profile.username
            });
        }).catch(err => {
            reject(err);
        })
    });
}

function fetchSlackProfile(user) {
    return new Promise((resolve, reject) => {
        if(user in slack_profiles_cache) {
            log(`Profile '${slack_profiles_cache[user].username}' (${user}) already in cache`, 'slack', 3);
            resolve(slack_profiles_cache[user]);
        }
        else {
            //not in our cache
            log(`Fetching profile for uncached ID ${user}...`, 'slack', 3);
            slackApp.client.users.profile.get({ user: user }).then(res => {
                const cached_profile = {
                    username: res.profile.display_name_normalized || res.profile.real_name_normalized,
                    avatar_url: res.profile.image_192
                };
                log(`Profile recieved for ${cached_profile.username}`, 'slack', 3);
                slack_profiles_cache[user] = cached_profile;
                resolve(cached_profile);
            }).catch(err => {
                reject(err);
            });
        }
    });
}

function forwardMessageToDiscord(slackMessage) {
    log(JSON.stringify(slackMessage, null, 3), 'slack', 3);


    const promises = [fetchSlackProfile(slackMessage.user), normaliseSlackMessage(slackMessage)];
    Promise.all(promises).then(results => {
        const fetched_profile = results[0];
        let content = results[1] || "";
    
        if(slackMessage.files && slackMessage.files.length > 0) {
            for(let attachment of slackMessage.files) {
                if(attachment.url_private) {
                    content += `\n${attachment.url_private}`;
                }
            }
        }

        let options = {
            'content': content,
            'username': fetched_profile.username,
            'avatarURL': fetched_profile.avatar_url
        };
        discordBot.executeWebhook(discordKey.hook_id, discordKey.hook_token, options);
    }).catch((err) => {
        log(`Error while forwarding to Discord: ${err}`, 'slack', 0)
    });
}

/*************************************************************/

slackApp.event('message', async ({ event, context }) => {
    if(event.user && event.channel == slackChannel) {
        forwardMessageToDiscord(event);
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
    if(msg.channel.name === discordKey.channel_name && msg.author.id !== discordKey.hook_id) {
        forwardMessageToSlack(msg);
    }
});

start();

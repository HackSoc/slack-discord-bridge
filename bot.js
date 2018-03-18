const Slack = require('@slack/client');
const Eris = require("eris");
const request = require('request');
const util = require('util');

// Init Slack first
const slackKey = require('./slack.keys.js');
var slackRTM = new Slack.RtmClient(slackKey.bot_token);
let slackChannel;

var slackWeb = new Slack.WebClient(slackKey.oauth_token);

const discordKey = require('./discord.keys.js');
var discordBot = new Eris(discordKey.bot_token);

const debugLogging = process.argv.indexOf('-v') >= 0;

function log(message, pre, level=0) {
    if(level == 0 || debugLogging) {
        console.log(`[${pre}]${'\t'}${message}`);
    }
}

function start() {
    log(`Logging in Slack with channel ${slackKey.channel_name}`, 'slack', 2);
    slackRTM.start();

    log(`Logging in Discord with channel ${discordKey.channel_name}`, 'discord', 2);
    discordBot.connect();
    discordBot.on('ready',  () => {
        log('Logged in OK', 'discord');
    });
}

function forwardMessageToSlack(discordMessage) {
    let displayName = discordMessage.member&&discordMessage.member.nick?discordMessage.member.nick:discordMessage.author.username;
    log(`displayName: ${displayName}`, 'discord', 3);
    let avatarURL = discordMessage.author.avatarURL.replace(/\.webp.*$/i, ".png"); // Might not work for users with default avatar
    log(`avatarURL: ${avatarURL}`, 'discord', 3);

    data = {
        text: discordMessage.content,
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

var slack_profiles_cache = {}

function normaliseSlackMessage(slackMessage) {
    return new Promise((resolve, reject) => {
        var channelRegex = /<#(?:.+?)\|([a-z0-9_-]{1,})>/g;
        var usernameRegex = /<@(.+?)>/g;
    
        // channel names can't contain [&<>]
        var cleanText = slackMessage.text.replace(channelRegex, "#$1");
        
        var userMatches = [];
        let match;
        while((match = usernameRegex.exec(cleanText)) != null) {
            userMatches.push(match);
        }
        // Matches is array of ["<@userid>", "userid"]
        // We want to map to array of {match: ["<@userid>", "userid"], name: "user name"}
        
        matchPromises = [];
        for(var userMatch of userMatches) {
            matchPromises.push(resolveSlackUserReplacement(userMatch));
        }
        Promise.all(matchPromises).then(userReplacements => {
            log(`replacements: ${JSON.stringify(userReplacements,null,3)}`, 'slack', 3);
            for(var replacement of userReplacements) {
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
            recieved_profile = {};
            slackWeb.users.profile.get({user: user}, (err, data) => {
                if(err) {
                    reject(err);
                }
                else {
                    var cached_profile = {
                        username: data.profile.display_name_normalized || data.profile.real_name_normalized,
                        avatar_url: data.profile.image_192
                    };
                    log(`Profile recieved for ${cached_profile.username}`, 'slack', 3);
                    slack_profiles_cache[user] = cached_profile;
                    resolve(cached_profile);
                }
            });

        }
    });
}// Can your python do this?

function forwardMessageToDiscord(slackMessage) {
    log(JSON.stringify(slackMessage, null, 3), 'slack', 3);
    var promises = [fetchSlackProfile(slackMessage.user), normaliseSlackMessage(slackMessage)];
    Promise.all(promises).then(results => {
        fetched_profile = results[0];
        // cleanText = results[1];
        let options = {
            'content': results[1],
            'username': fetched_profile.username,
            'avatarURL': fetched_profile.avatar_url
        };
        // discordHook.send(cleanText, options).then( (message) => {}).catch((err) => {
        //     log(`Error while posting hook to Discord: ${err}`, 'slack', 0);
        // })
        discordBot.executeWebhook(discordKey.hook_id, discordKey.hook_token, options);
    }).catch((err) => {
        log(`Error while forwarding to Discord: ${err}`, 'slack', 0)
    });    
}

/*************************************************************/

slackRTM.on(Slack.CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
    for(const c of rtmStartData.channels) {
        if(c.is_member && c.name === slackKey.channel_name) {
            slackChannel = c.id 
            log(`Logged in OK and selected channel ${c.name}`, 'slack');
            break;
        }
    }
    if(!slackChannel) {
        log(`Channel ${slackKey.channel_name} not found`, 'slack');
        process.exit(6);
    }
});

slackRTM.on(Slack.RTM_EVENTS.MESSAGE, (message) => {
    if(message.user && message.channel == slackChannel) {
       forwardMessageToDiscord(message); 
    }
    else {
        //No user id => author is probably a webhook
    }
});

slackRTM.on(Slack.RTM_EVENTS.USER_CHANGE, (event) => {
    var updated_profile = {
        username: event.user.profile.display_name_normalized || event.user.profile.real_name_normalized,
        avatar_url: event.user.profile.image_192
    }
    log(`USER_CHANGE event for ${updated_profile.username}`, 'slack', 2);
    slack_profiles_cache[event.user.profile.id] = updated_profile;
});

discordBot.on('messageCreate', msg => {    
    if(msg.channel.name === discordKey.channel_name && msg.author.id !== discordKey.hook_id) {
        forwardMessageToSlack(msg);
    }
});

start();
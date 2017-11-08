const Slack = require('@slack/client');
const Discord = require('discord.js');
const request = require('request');

// Init Slack first
const slackKey = require('./slack.keys.js');
var slackRTM = new Slack.RtmClient(slackKey.bot_token);
let slackChannel;

var slackWeb = new Slack.WebClient(slackKey.oauth_token);

const discordKey = require('./discord.keys.js');
var discordHook = new Discord.WebhookClient(discordKey.hook_id, discordKey.hook_token);
var discordBot = new Discord.Client();

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
    discordBot.login(discordKey.bot_token).then( () => {
        log('Logged in OK', 'discord');
    } ).catch(err => {
        log(`Error when logging in: ${err}`, 'discord');
    })
}

function forwardMessageToSlack(message) {
    let avatarURL = message.author.avatarURL.replace(/\.webp.*$/i, ".png");

    log(`displayName: ${message.member.displayName}`, 'discord', 3);
    log(`avatarURL: ${avatarURL}`, 'discord', 3);

    data = {
        text: message.content,
        username: message.member.displayName,
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

function fetchSlackProfile(user) {
    return new Promise((resolve, reject) => {
        if(user in slack_profiles_cache) {
            log(`Profile '${slack_profiles_cache[user].username} (${user} already in cache`, 'slack', 3);
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
                        avatar_url: data.profile.image_1024
                    };
                    log(`Profile recieved for ${cached_profile.username}`, 'slack', 3);
                    slack_profiles_cache[user] = cached_profile;
                    resolve(cached_profile);
                }
            });

        }
    });
}// Can your python do this?

function forwardMessageToDiscord(message) {
    fetchSlackProfile(message.user).then((fetched_profile) => {
        let options = {
            'username': fetched_profile.username,
            'avatarURL': fetched_profile.avatar_url
        };
        discordHook.send(message.text, options).then( (message) => {}).catch((err) => {
            log(`Error while posting hook to Discord: ${err}`, 'slack', 0);
        })
    }).catch((err) => {
        log(`Error while fetching profile: ${err}`, 'slack', 0)
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

discordBot.on('message', message => {
    if(!message.author.bot && message.channel.name === discordKey.channel_name){
        forwardMessageToSlack(message);
    }
})

start();
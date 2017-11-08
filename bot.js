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

function start() {
    slackRTM.start();
    discordBot.login(discordKey.bot_token).then( () => {
        console.log(`[discord] Logged in OK.`)
    } ).catch(err => {
        console.log(`[discord] Error when logging in: ${err}`);
    })
}

function forwardMessageToSlack(message) {
    let avatarURL = message.author.avatarURL.replace(/\.webp.*$/i, ".png");

    data = {
        text: message.content,
        username: message.member.displayName,
        icon_url: avatarURL
    }

    request({
        url: slackKey.hook_url,
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        json: data
    }, (err, resp, body) => {
        if(err) {
            console.log(`[discord] Error while posting hook to Slack: ${err}`)
        }
        else {
            //we good
        }
    })
}

var slack_profiles_cache = {}

function fetchSlackProfile(user) {
    return new Promise((resolve, reject) => {
        if(user in slack_profiles_cache) {
            resolve(slack_profiles_cache[user]);
        }
        else {
            //not in our cache
            console.log(`[slack]   Fetching profile for uncached ID ${user}...`)
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
            console.log(`[slack]   Error while posting hook to Discord`);
        })
    }).catch((err) => {
        console.log(`[slack]   Error while fetching profile: ${err}`);
    });    
}

/*************************************************************/

slackRTM.on(Slack.CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
    for(const c of rtmStartData.channels) {
        if(c.is_member && c.name === slackKey.channel_name) {
            slackChannel = c.id 
            console.log(`[slack]   Logged in OK and selected channel ${c.name}.`)
            break;
        }
    }
    if(!slackChannel) {
        console.log(`[slack]   Channel ${slackKey.channel_name} not found`)
        process.exit(6);
    }
});

slackRTM.on(Slack.RTM_EVENTS.MESSAGE, (message) => {
    if(message.user) {
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
# slack-discord-bridge
*Bridges a text channel between Slack and Discord*

## Setup
0. Prerequisites  

You need to have [Node.js](https://nodejs.org/en/download/) installed. This includes the runtime and the package manager required to install the dependencies.
1. Clone the repository
```
git clone git@github.com:HackSoc/slack-discord-bridge.git
```
2. Install dependencies
```
cd slack-discord-bridge
npm install
```
3. Set up API keys

Make copies of `discord.keys.js.example` and `slack.keys.js.example` and remove the `.example` ending. 

For Discord, you need to [create an app](https://discordapp.com/developers/applications/me), then click "create bot user". Copy the bot user token into the `bot_token` field of `discord.keys.js`.  
Next you need to create a webhook for the Discord channel of your choice. Click "Edit channel" (gear icon next to a text channel) and go to the webhooks section of the menu. (Note you will need the "Manage Webhooks" permission on your Discord server). Copy the ID and token (explained in `discord.keys.js`) into the relevant fields.

For Slack, it's a little more complicated. [Create a new app](https://api.slack.com/apps) and choose your workspace from the list.  
First go to OAuth & Permissions, and if you haven't already, add the bot to your workspace. 
Scroll to Scopes and add `users.profile:read`.  
Save changes, then go to Bot Users and add a bot user.  
Finally go back to OAuth & Permissions and install the app to your workspace.  
Copy the OAuth and Bot tokens to the correct places in `slack.keys.js`.   

Now you need to add an [Incoming Webhook](https://hacksoc-york.slack.com/apps/A0F7XDUAZ-incoming-webhooks) as a custom integration. *Note that if you add this as part of the Slack app you created, the messages on Slack won't have the username or avatar of the Discord users sending them*. Choose the channel you want the webhook to post in, and copy the URL to `hook_url` in `slack.keys.js`.

4. Running

`node bot.js` will run the bot until you stop it with `Ctrl-C`, but you may wish to leave it running longer than you have a terminal window open. An application running in the background is called a *daemon*. One way of daemonising this bot is to use `pm2`. After you have [installed](http://pm2.keymetrics.io/) it, just run `pm2 start bot.js` in the same directory as `bot.js`.

# Console JS client SmartHoldem

CLI client for SmartHoldem blockchain. You can connect to devnet, mainnet or your custom private/public blockchain.

- connect to network or a node,
- get stats of a network,
- create or get status of an account,
- create vanity accounts (multi-cpu supported),
- register a delegate,
- vote for a delegate,
- sign and verify message using your address.


## Installation

Node v > 8.0

```
> npm install -g https://github.com/smartholdem/smartholdem-cli
> smartholdem-cli

   _____                      __  __  __      __    __                  _________            __
  / ___/____ ___  ____ ______/ /_/ / / /___  / /___/ /__  ____ ___     / ____/ (_)__  ____  / /_
  \__ \/ __ `__ \/ __ `/ ___/ __/ /_/ / __ \/ / __  / _ \/ __ `__ \   / /   / / / _ \/ __ \/ __/
 ___/ / / / / / / /_/ / /  / /_/ __  / /_/ / / /_/ /  __/ / / / / /  / /___/ / /  __/ / / / /_
/____/_/ /_/ /_/\__,_/_/   \__/_/ /_/\____/_/\__,_/\___/_/ /_/ /_/   \____/_/_/\___/_/ /_/\__/

smartholdem> help

  Commands:

    help [command...]                     Provides help for a given command.
    exit                                  Exits application.
    connect <network>                     Connect to network. Network is devnet or mainnet
    connect node <url>                    Connect to a server. For example "connect node 5.39.9.251:4000"
    disconnect                            Disconnect from server or network
    network stats                         Get stats from network
    account status <address>              Get account status
    account vote <name>                   Vote for delegate <name>. Remove previous vote if needed
    account unvote                        Remove previous vote
    account send <amount> <address>       Send <amount> STH to <address>. <amount> format examples: 10, USD10.4, EUR100 !!! Do not use this is a future function
    account delegate <username>           Register new delegate with <username>
    account create                        Generate a new random cold account
    account vanity <string>               Generate an address containing lowercased <string> (WARNING you could wait for long)
    message sign <message>                Sign a message
    message verify <message> <publickey>  Verify the <message> signed by the owner of <publickey> (you will be prompted to provide the signature)


```


#!/usr/bin/env node
const sthjs = require("sthjs");
const crypto = require("crypto");
const figlet = require("figlet");
const colors = require("colors");
const request = require("request");
const requestPromise = require("request-promise-native");
///const asciichart = require ('asciichart');
///const chart = require ('chart');
///const cliSpinners = require('cli-spinners');
const Table = require('ascii-table');
const ora = require('ora');
const cowsay = require('cowsay');
const async = require('async');
const vorpal = require('vorpal')();
///const cluster = require('cluster');
const child_process = require('child_process');
const Path = require('path');

var ledgerSupported = true;
try {
  var ledger = require('ledgerco');
  var LedgerSth = require('./src/LedgerSth.js');
  var ledgerWorker = child_process.fork(Path.resolve(__dirname, './ledger-worker'));
} catch (USBError) {
  ledgerSupported = false;
  vorpal.log(colors.yellow("Warning: SmartHoldem-Client is running on a server or virtual machine: No Ledger support available."));
}

var blessed = require('blessed');
var contrib = require('blessed-contrib');

var connected = false;
var server;
var network;
var sthticker = {};
const currencies = ["USD","AUD", "BRL", "CAD", "CHF", "CNY", "EUR", "GBP", "HKD", "IDR", "INR", "JPY", "KRW", "MXN", "RUB"];

var ledgerAccounts = [];
var ledgerBridge = null;
var ledgerComm   = null;

const networks = {
  devnet: {
    nethash: "3a6d2bec6798dedea99a1e6c64120a3876781b85e46bb75908aba07ffda61360",
    peers: [
      "88.198.67.196:6101",
      "213.239.207.170:6101",
      "80.211.38.83:6101"
    ],
    ledgerpath: "44'/1'/"
  },
  mainnet: {
    nethash: "fc46bfaf9379121dd6b09f5014595c7b7bd52a0a6d57c5aff790b42a73c76da7",
    peers: [
        "95.216.142.160:6100",
        "95.216.136.246:6100",
        "138.201.94.238:6100",
        "213.239.207.170:6100",
        "88.198.67.196:6100",
        "95.183.9.207:6100",
        "95.183.9.191:6100",
        "156.67.218.218:6100",
        "31.220.52.1:6100",
        "89.36.212.238:6100",
        "94.177.255.148:6100",
        "80.211.31.231:6100",
        "80.211.31.162:6100",
        "80.211.31.241:6100",
        "80.211.31.222:6100",
        "80.211.31.90:6100",
        "80.211.31.13:6100",
        "80.211.237.199:6100",
        "94.177.213.55:6100",
        "80.211.32.86:6100",
        "188.213.168.227:6100",
        "194.182.72.198:6100",
        "194.182.68.74:6100",
        "194.182.74.66:6100",
        "194.182.74.87:6100",
        "194.182.74.137:6100",
        "194.182.74.218:6100",
        "194.182.74.133:6100",
        "194.182.74.133:6100",
        "136.243.65.148:6100"
    ],
    ledgerpath: "44'/255'/"
  }
};

function isConnected() {
  return server && connected;
}

function getNetworkFromNethash(nethash){
  for(var n in networks){
    if(networks[n].nethash == nethash){
      return n;
    }
  }
  return "unknown";
}

function findEnabledPeers(cb){
  var peers=[];
  getFromNode('http://'+server+'/peer/list', function(err, response, body){

    if(err){
      vorpal.log(colors.red("Can't get peers from network: " + err));
      return cb(peers);
    }
    else {
      var respeers = JSON.parse(body).peers.map(function(peer){
        return peer.ip+":"+peer.port;
      }).filter(function(peer){
        return peer.status=="OK";
      });
      async.each(respeers, function(peer, cb){
        getFromNode('http://'+peer+'/api/blocks/getHeight', function(err, response, body){
          if(body != "Forbidden"){
            peers.push(peer);
          }
          cb();
        });
      },function(err){
        return cb(peers);
      });
    }
  });
}

function postTransaction(container, transaction, cb){
  var performPost = function() {
    request({
      url: 'http://'+server+'/peer/transactions',
      headers: {
        nethash: network.nethash,
        version: '1.0.0',
        port:1
      },
      method: 'POST',
      json: true,
      body: {transactions:[transaction]}
    }, cb);
  };

  let senderAddress = sthjs.crypto.getAddress(transaction.senderPublicKey);
  getFromNode('http://' + server + '/api/accounts?address=' + senderAddress, function(err, response, body){

    if(!err && body) {
      try {
        body = JSON.parse(body);
        if ( !body.hasOwnProperty('success') || body.success === false) {
          // The account does not yet exist on the connected node.
          throw "Failed: " + body.error;
        }
        if (body.hasOwnProperty('account') && body.account.secondSignature) {
          container.prompt({
            type: 'password',
            name: 'passphrase',
            message: 'Second passphrase: ',
          }, function(result) {
            if (result.passphrase) {
              var secondKeys = sthjs.crypto.getKeys(result.passphrase);
              sthjs.crypto.secondSign(transaction, secondKeys);
              transaction.id = sthjs.crypto.getId(transaction);
            } else {
              vorpal.log('No second passphrase given. Trying without.');
            }
          });
        }
      } catch (error) {
        vorpal.log(colors.red(error));
      }
    } // if(body)
    performPost();
  });
}

function getFromNode(url, cb){
  let nethash=network?network.nethash:"";
  request(
    {
      url: url,
      headers: {
        nethash: nethash,
        version: '1.0.0',
        port:1
      },
      timeout: 5000
    },
    cb
  );
}

function getSTHTicker(currency){
  request({url: "https://api.coinmarketcap.com/v1/ticker/sth/?convert="+currency}, function(err, response, body){
    sthticker[currency]=JSON.parse(body)[0];
  });
}

function getAccount(container, seriesCb) {
  var getPassPhrase = function() {
    container.prompt({
      type: 'password',
      name: 'passphrase',
      message: 'passphrase: ',
    }, function(result){
      if (result.passphrase) {
        return seriesCb(null, {
          passphrase: result.passphrase,
        });
      } else{
        return seriesCb("Aborted.");
      }
    });
  };
  if (ledgerSupported && ledgerAccounts.length) {
    var message = 'We have found the following Ledgers: \n';
    ledgerAccounts.forEach(function(ledger, index) {
      var balance = network.config.symbol + (ledger.data.accountData.balance / 100000000);
      message += (index + 1) + ') ' + ledger.data.address + ' (' + balance + ')' + '\n';
    });
    message += 'N) passphrase\n\n';
    message += 'Please choose an option: ';
    container.prompt({
      type: 'input',
      name: 'account',
      message: message,
    }, function(result){
      if (result.account.toUpperCase() === 'N') {
        getPassPhrase();
      } else if (ledgerAccounts[result.account - 1]) {
        var ledger = ledgerAccounts[result.account - 1];
        return seriesCb(null, {
          address: ledger.data.address,
          publicKey: ledger.data.publicKey,
          path: ledger.path,
        });
      } else {
        return seriesCb("Failed to get Accounts");
      }
    });
  } else {
    getPassPhrase();
  }
}

function resetLedger() {
  ledgerAccounts = [];
  ledgerBridge = null;
  if (ledgerComm !== null) {
    ledgerComm.close_async();
    ledgerComm   = null;
  }
}

async function populateLedgerAccounts() {
  if (!ledgerSupported || !ledgerBridge) {
    return;
  }
  ledgerAccounts = [];
  ///var accounts = [];
  var account_index = 0;
  var path = network.hasOwnProperty('ledgerpath') ? network.ledgerpath : "44'/255'/";
  var empty = false;

  while (!empty) {
    var localpath = path + account_index + "'/0/0";
    var result = null;
    try {
      await ledgerBridge.getAddress_async(localpath).then(
        (response) => { result = response }
      ).fail(
        (response) => { result = response }
      );
      if (result.publicKey) {
        result.address = sthjs.crypto.getAddress(result.publicKey);
        var accountData = null;
        await requestPromise({
          uri: 'http://' + server + '/api/accounts?address=' + result.address,
          headers: {
            nethash: network.nethash,
            version: '1.0.0',
            port: 1
          },
          timeout: 5000,
          json: true,
        }).then(
          (body) => { accountData = body }
        );
        if (!accountData || accountData.success === false) {
          // Add an empty available account when 0 transactions have been made.
          empty = true;
          result.accountData = {
            address: result.address,
            unconfirmedBalance: "0",
            balance: "0",
            publicKey: result.publicKey,
            unconfirmedSignature: 0,
            secondSignature: 0,
            secondPublicKey: null,
            multisignatures: [],
            u_multisignatures: []
          };
        } else {
          result.accountData = accountData.account;
        }
      }
    } catch (e) {
      console.log('no request:', e);
      break;
    }
    if (result && result.address) {
      ledgerAccounts.push({
        data: result,
        path: localpath
      });
      account_index = account_index + 1;
    } else {
      empty = true;
    }
  }

  if (ledgerAccounts.length) {
    vorpal.log('Ledger App Connected');
  }
}

async function ledgerSignTransaction(seriesCb, transaction, account, callback) {
  if (!ledgerSupported || !account.publicKey || !account.path) {
    return callback(transaction);
  }

  transaction.senderId = account.address;
  if (transaction.type === 3) {
    transaction.recipientId = account.address;
  }
  transaction.senderPublicKey = account.publicKey;
  delete transaction.signature;
  var transactionHex = sthjs.crypto.getBytes(transaction, true, true).toString("hex");
  var result = null;
  console.log('Please sign the transaction on your Ledger');
  await ledgerBridge.signTransaction_async(account.path, transactionHex).then(
    (response) => { result = response }
  ).fail(
    (response) => { result = response }
  );
  if (result.signature && result.signature === '00000100') {
    return seriesCb('We could not sign the transaction. Close everything using the Ledger and try again.');
  } else if (result.signature) {
    transaction.signature = result.signature;
    transaction.id = sthjs.crypto.getId(transaction);
  } else {
    transaction = null;
  }
  callback(transaction);
}

if (ledgerSupported) {
ledgerWorker.on('message', function (message) {
  if (message.connected && network && (!ledgerComm || !ledgerAccounts.length)) {
    ledger.comm_node.create_async().then((comm) => {
      ledgerComm = comm;
      ledgerBridge = new LedgerSth(ledgerComm);
      populateLedgerAccounts();
    }).fail((error) => {
      //vorpal.log(colors.red('ledger error: ' +error));
    });
  } else if (!message.connected && ledgerComm) {
    vorpal.log('Ledger App Disconnected');
    resetLedger();
  }
});
}

vorpal
  .command('connect <network>', 'Connect to network. Network is devnet or mainnet')
  .action(function(args, callback) {
    // reset an existing connection first
    if(server) {
      server=null;
      network=null;
      resetLedger();
    }

		var self = this;
    network = networks[args.network];

    if(!network){
        self.log("Network not found");
        return callback();
    }

    connect2network(network,function(){
      getFromNode('http://'+server+'/peer/status', function(err, response, body){
        self.log("Node: " + server + ", height: " + JSON.parse(body).height);
        self.delimiter('sth '+args.network+'>');
        sthjs.crypto.setNetworkVersion(network.config.version);
	connected = true;
        callback();
      });
    });

  });

function connect2network(n, callback){
  server = n.peers[Math.floor(Math.random()*1000)%n.peers.length];
  findEnabledPeers(function(peers){
    if(peers.length>0){
      server=peers[0];
      n.peers=peers;
    }
  });
  getFromNode('http://'+server+'/api/loader/autoconfigure', function(err, response, body){
    if(!body) connect2network(n, callback);
    else{
      n.config = JSON.parse(body).network;
      vorpal.log(n.config);
      callback();
    }
  });
}


vorpal
  .command('connect node <url>', 'Connect to a server. For example "connect node 88.198.67.196:6100"')
  .action(function(args, callback) {
    // reset an existing connection first
    if(server) {
      server=null;
      network=null;
      resetLedger();
    }

		var self = this;
    server=args.url;
    getFromNode('http://'+server+'/api/blocks/getNethash', function(err, response, body){
      if(err){
        self.log(colors.red("Public API unreacheable on this server "+server+" - "+err));
        server=null;
        self.delimiter('sth>');
        return callback();
      }
      try {
        var nethash = JSON.parse(body).nethash;
      }
      catch (error){
        self.log(colors.red("API is not returning expected result:"));
        self.log(body);
        server=null;
        self.delimiter('sth>');
        return callback();
      }

      var networkname = getNetworkFromNethash(nethash);
      network = networks[networkname];
      if(!network){
        network = {
          nethash: nethash,
          peers:[server]
        };
        networks[nethash]=network;
      }
      getFromNode('http://'+server+'/api/loader/autoconfigure', function(err, response, body){
        network.config = JSON.parse(body).network;
        console.log(network.config);
      });
      self.log("Connected to network " + nethash + colors.green(" ("+networkname+")"));
      self.delimiter('sth '+server+'>');
      getFromNode('http://'+server+'/peer/status', function(err, response, body){
        self.log("Node height ", JSON.parse(body).height);
      });
      connected = true;
      callback();
    });
  });

vorpal
  .command('disconnect', 'Disconnect from server or network')
  .action(function(args, callback) {
		var self = this;
    self.log("Disconnected from "+server);
    self.delimiter('sth>');
    server=null;
    network=null;
    connected = false;

    resetLedger();
    callback();
  });

vorpal
  .command('network stats', 'Get stats from network')
  .action(function(args, callback) {
    var self = this;
    if(!isConnected()){
      self.log("Please connect to node or network before");
      return callback();
    }
		getFromNode('http://'+server+'/peer/list', function(err, response, body){
      if(err){
        self.log(colors.red("Can't get peers from network: " + err));
        return callback();
      }
      else {
        var peers = JSON.parse(body).peers.map(function(peer){
          return peer.ip+":"+peer.port;
        });
        self.log("Checking "+peers.length+" peers");
        var spinner = ora({text:"0%",spinner:"shsth"}).start();
        var heights={};
        var delays={};
        var count=0;
        async.each(peers, function(peer, cb){
          var delay=new Date().getTime();
          getFromNode('http://'+peer+'/peer/status', function(err, response, hbody){
            delay=new Date().getTime()-delay;
            if(delays[10*Math.floor(delay/10)]){
              delays[10*Math.floor(delay/10)]++;
            }
            else{
              delays[10*Math.floor(delay/10)]=1;
            }
            count++;
            spinner.text=Math.floor(100*count/peers.length)+"%";
            if(err){
              return cb();
            }
            else{
              var height=JSON.parse(hbody).height;
              if(!height){
                return cb();
              }
              if(heights[height]){
                heights[height]++;
              }
              else{
                heights[height]=1;
              }
              return cb();
            }
            return cb();
          });
        },function(err){
          spinner.stop();
          var screen = blessed.screen();
          var grid = new contrib.grid({rows: 12, cols: 12, screen: screen});
          var line = grid.set(0, 0, 6, 6, contrib.line,
              { style:
                 { line: "yellow"
                 , text: "green"
                 , baseline: "black"}
               , xLabelPadding: 3
               , xPadding: 5
               , label: 'Delays'});
          var data = {
               x: Object.keys(delays).map(function(d){return d+"ms"}),
               y: Object.values(delays)
            };
          screen.append(line); //must append before setting data
          line.setData([data]);

          var bar = grid.set(6, 0, 6, 12, contrib.bar, { label: 'Network Height', barWidth: 4, barSpacing: 6, xOffset: 0, maxHeight: 9});
          screen.append(bar); //must append before setting data
          bar.setData({titles: Object.keys(heights), data: Object.values(heights)});

          screen.onceKey(['escape'], function(ch, key) {
            screen.destroy();
          });
          screen.render();
        });
      }
    });

  });

vorpal
  .command('account status <address>', 'Get account status')
  .action(function(args, callback) {
    var self = this;
    if(!isConnected()){
      self.log("please connect to node or network before");
      return callback();
    }
    var address=args.address;
    getFromNode('http://'+server+'/api/accounts?address='+address, function(err, response, body){
      var a = JSON.parse(body).account;

      if(!a){
        self.log("Unknown on the blockchain");
        return callback();
      }
      for(var i in a){
        if(!a[i] || a[i].length === 0) delete a[i];
      }
      delete a.address;
      var table = new Table();
      table.setHeading(Object.keys(a));
      var rowItems = [];
      Object.keys(a).map(function (key) {
        var value = a[key];
        if (['unconfirmedBalance', 'balance'].includes(key)) {
          value = value / 100000000;
        }
        rowItems.push(value);
      });
      table.addRow(rowItems);
      self.log(table.toString());
      getFromNode('http://'+server+'/api/delegates/get/?publicKey='+a.publicKey, function(err, response, body){
        body = JSON.parse(body);
        if(body.success){
          var delegate=body.delegate;
          delete delegate.address;
          delete delegate.publicKey;
          table = new Table("Delegate");
          table.setHeading(Object.keys(delegate));
          table.addRow(Object.values(delegate));
          self.log(table.toString());
        }

        callback();
      });
    });
  });

vorpal
  .command('account vote <name>', 'Vote for delegate <name>. Remove previous vote if needed')
  .action(function(args, callback) {
    var self = this;
    if(!isConnected()){
      self.log("please connect to node or network before");
      return callback();
    }
    async.waterfall([
      function(seriesCb) {
        getAccount(self, seriesCb);
      },
      function(account, seriesCb) {
        var delegateName = args.name;
        var address = null;
        var publicKey = null;
        var passphrase = '';
        if (account.passphrase) {
          passphrase = account.passphrase;
          var keys = sthjs.crypto.getKeys(passphrase);
          publicKey = keys.publicKey;
          address = sthjs.crypto.getAddress(publicKey);
        } else if (account.publicKey) {
          address = account.address;
          publicKey = account.publicKey;
        } else {
          return seriesCb('No public key for account');
        }
        getFromNode('http://'+server+'/api/accounts/delegates/?address='+address, function(err, response, body) {
          body = JSON.parse(body);
          if (!body.success) {
            return seriesCb("Failed getting current vote: " + body.error);
          }
          var currentVote = null;
          if (body.delegates.length) {
            currentVote = body.delegates.pop();
            if (currentVote.username === delegateName) {
              return seriesCb('You have already voted for ' + delegateName);
            }
          }
          getFromNode('http://'+server+'/api/delegates/get/?username='+delegateName, function(err, response, body){
            body = JSON.parse(body);
            if (!body.success) {
              return seriesCb("Failed: " + body.error);
            }
            var newDelegate = body.delegate;
            var confirmMessage = 'Vote for ' + delegateName + ' now';
            if (currentVote) {
              confirmMessage = 'Vote for ' + delegateName + ' and unvote ' + currentVote.username + ' now';
            }
            self.prompt({
              type: 'confirm',
              name: 'continue',
              default: false,
              message: confirmMessage,
            }, function(result){
              if (result.continue) {
                if (currentVote) {
                  try {
                    var unvoteTransaction = sthjs.vote.createVote(passphrase, ['-'+currentVote.publicKey]);
                  } catch (error) {
                    return seriesCb('Failed: ' + error);
                  }
                  ledgerSignTransaction(seriesCb, unvoteTransaction, account, function(unvoteTransaction) {
                    if (!unvoteTransaction) {
                      return seriesCb('Failed to sign unvote transaction with ledger');
                    }
                    postTransaction(self, unvoteTransaction, function(err, response, body) {
                      if (err) {
                        return seriesCb('Failed to unvote previous delegate: ' + err);
                      } else if (!body.success){
                        return seriesCb("Failed to send unvote transaction: " + body.error);
                      }
                      var transactionId = body.transactionIds.pop();
                      console.log('Waiting for unvote transaction (' + transactionId + ') to confirm.');
                      var checkTransactionTimerId = setInterval(function() {
                        getFromNode('http://' + server + '/api/transactions/get?id=' + transactionId, function(err, response, body) {
                          body = JSON.parse(body);
                          if (!body.success && body.error !== 'Transaction not found') {
                            clearInterval(checkTransactionTimerId);
                            return seriesCb('Failed to fetch unconfirmed transaction: ' + body.error);
                          } else if (body.transaction) {
                            clearInterval(checkTransactionTimerId);
                            try {
                              var transaction = sthjs.vote.createVote(passphrase, ['+'+newDelegate.publicKey]);
                            } catch (error) {
                              return seriesCb('Failed: ' + error);
                            }
                            ledgerSignTransaction(seriesCb, transaction, account, function(transaction) {
                              if (!transaction) {
                                return seriesCb('Failed to sign vote transaction with ledger');
                              }
                              return seriesCb(null, transaction);
                            });
                          }
                        });
                      }, 2000);
                    });
                  });
                } else {
                  try {
                    var transaction = sthjs.vote.createVote(passphrase, ['+'+newDelegate.publicKey]);
                  } catch (error) {
                    return seriesCb('Failed: ' + error);
                  }
                  ledgerSignTransaction(seriesCb, transaction, account, function(transaction) {
                    if (!transaction) {
                      return seriesCb('Failed to sign transaction with ledger');
                    }
                    return seriesCb(null, transaction);
                  });
                }
              } else {
                return seriesCb("Aborted.");
              }
            });
          });
        });
      },
      function(transaction, seriesCb){
        postTransaction(self, transaction, function(err, response, body){
          if(err){
            seriesCb("Failed to send transaction: " + err);
          }
          else if(body.success){
            seriesCb(null, transaction);
          }
          else {
            seriesCb("Failed to send transaction: " + body.error);
          }
        });
      }
    ], function(err, transaction){
      if(err){
        self.log(colors.red(err));
      }
      else{
        self.log(colors.green("Transaction sent successfully with id "+transaction.id));
      }
      return callback();
    });
  });

vorpal
  .command('account unvote', 'Remove previous vote')
  .action(function(args, callback) {
    var self = this;
    if(!isConnected()){
      self.log("please connect to node or network before");
      return callback();
    }
    async.waterfall([
      function(seriesCb){
        getAccount(self, seriesCb);
      },
      function(account, seriesCb){
        var address = null;
        var publicKey = null;
        var passphrase = '';
        if (account.passphrase) {
          passphrase = account.passphrase;
          var keys = sthjs.crypto.getKeys(passphrase);
          publicKey = keys.publicKey;
          address = sthjs.crypto.getAddress(publicKey);
        } else if (account.publicKey) {
          address = account.address;
          publicKey = account.publicKey;
        } else {
          return seriesCb('No public key for account');
        }
        getFromNode('http://'+server+'/api/accounts/delegates/?address='+address, function(err, response, body) {
          body = JSON.parse(body);
          if (!body.success) {
            return seriesCb("Failed: " + body.error);
          }
          if (!body.delegates.length) {
            return seriesCb("You currently haven't voted for anyone.");
          }
          var lastDelegate = body.delegates.pop();
          var delegates = ['-' + lastDelegate.publicKey];
          self.prompt({
            type: 'confirm',
            name: 'continue',
            default: false,
            message: 'Removing last vote for ' + lastDelegate.username,
          }, function(result){
            if (result.continue) {
              try {
                var transaction = sthjs.vote.createVote(passphrase, delegates);
              } catch (error) {
                return seriesCb('Failed: ' + error);
              }
              ledgerSignTransaction(seriesCb, transaction, account, function(transaction) {
                if (!transaction) {
                  return seriesCb('Failed to sign transaction with ledger');
                }
                return seriesCb(null, transaction);
              });
            } else {
              return seriesCb("Aborted.");
            }
          });
        });
      },
      function(transaction, seriesCb){
        postTransaction(self, transaction, function(err, response, body){
          if(err){
            seriesCb("Failed to send transaction: " + err);
          }
          else if(body.success){
            seriesCb(null, transaction);
          }
          else {
            seriesCb("Failed to send transaction: " + body.error);
          }
        });
      }
    ], function(err, transaction){
      if(err){
        self.log(colors.red(err));
      }
      else{
        self.log(colors.green("Transaction sent successfully with id "+transaction.id));
      }
      return callback();
    });
  });

vorpal
  .command('account send <amount> <address>', 'Send <amount> STH to <address>. <amount> format examples: 10, USD10.4, EUR100 !!! Do not use this is a future function')
  .action(function(args, callback) {
    var self = this;
    if(!isConnected()){
      self.log("please connect to node or network before");
      return callback();
    }
    var currency;
    var found = false;

    if(typeof args.amount != "number")
    {

      for(var i in currencies)
      {
        if(args.amount.startsWith(currencies[i]))
        {
          currency=currencies[i];
          args.amount = Number(args.amount.replace(currency,""));
          getSTHTicker(currency);
          found = true;
          break;
        }
      }

      if(!found)
      {
        self.log("Invalid Currency Format");
        return callback();
      }
    }

    async.waterfall([
      function(seriesCb){
        getAccount(self, seriesCb);
      },
      function(account, seriesCb){
        var address = null;
        var publicKey = null;
        var passphrase = '';
        if (account.passphrase) {
          passphrase = account.passphrase;
          var keys = sthjs.crypto.getKeys(passphrase);
          publicKey = keys.publicKey;
          address = sthjs.crypto.getAddress(publicKey);
        } else if (account.publicKey) {
          address = account.address;
          publicKey = account.publicKey;
        } else {
          return seriesCb('No public key for account');
        }

        var sthamount = args.amount;
        var sthAmountString = args.amount;

        if(currency){
          if(!sthticker[currency]){
            return seriesCb("Can't get price from market. Aborted.");
          }
          sthamount = parseInt(args.amount * 100000000 / Number(sthticker[currency]["price_"+currency.toLowerCase()]),10);
          sthAmountString = sthamount/100000000;
        } else {
          sthamount = parseInt(args.amount * 100000000, 10);
        }

        self.prompt({
          type: 'confirm',
          name: 'continue',
          default: false,
          message: 'Sending ' + sthAmountString + ' ' + network.config.token+' '+(currency?'('+currency+args.amount+') ':'')+'to '+args.address+' now',
        }, function(result){
          if (result.continue) {
            try {
              var transaction = sthjs.transaction.createTransaction(args.address, sthamount, null, passphrase);
            } catch (error) {
              return seriesCb('Failed: ' + error);
            }
            ledgerSignTransaction(seriesCb, transaction, account, function(transaction) {
              if (!transaction) {
                return seriesCb('Failed to sign transaction with ledger');
              }
              return seriesCb(null, transaction);
            });
          }
          else {
            return seriesCb("Aborted.");
          }
        });
      },
      function(transaction, seriesCb){
        postTransaction(self, transaction, function(err, response, body){
          if(err){
            seriesCb("Failed to send transaction: " + err);
          }
          else if(body.success){
            seriesCb(null, transaction);
          }
          else {
            seriesCb("Failed to send transaction: " + body.error);
          }
        });
      }
    ], function(err, transaction){
      if(err){
        self.log(colors.red(err));
      }
      else{
        self.log(colors.green("Transaction sent successfully with id "+transaction.id));
      }
      return callback();
    });
  });

vorpal
  .command('account delegate <username>', 'Register new delegate with <username> ')
  .action(function(args, callback) {
    var self = this;
    if(!isConnected()){
      self.log("please connect to node or network before");
      return callback();
    }
    async.waterfall([
      function(seriesCb) {
        getAccount(self, seriesCb);
      },
      function(account, seriesCb) {
        var address = null;
        var publicKey = null;
        var passphrase = '';
        if (account.passphrase) {
          passphrase = account.passphrase;
          var keys = sthjs.crypto.getKeys(passphrase);
          publicKey = keys.publicKey;
          address = sthjs.crypto.getAddress(publicKey);
        } else if (account.publicKey) {
          address = account.address;
          publicKey = account.publicKey;
        } else {
          return seriesCb('No public key for account');
        }
        try {
          var transaction = sthjs.delegate.createDelegate(passphrase, args.username);
        } catch (error) {
          return seriesCb('Failed: ' + error);
        }
        ledgerSignTransaction(seriesCb, transaction, account, function(transaction) {
          if (!transaction) {
            return seriesCb('Failed to sign transaction with ledger');
          }
          return seriesCb(null, transaction);
        });
      },
      function(transaction, seriesCb) {
        postTransaction(self, transaction, function(err, response, body){
          if(err){
            seriesCb("Failed to send transaction: " + err);
          }
          else if(body.success){
            seriesCb(null, transaction);
          }
          else {
            seriesCb("Failed to send transaction: " + body.error);
          }
        });
      }
    ], function(err, transaction){
      if(err){
        self.log(colors.red(err));
      }
      else{
        self.log(colors.green("Transaction sent successfully with id "+transaction.id));
      }
      return callback();
    });
  });


vorpal
  .command('account create', 'Generate a new random cold account')
  .action(function(args, callback) {
    var self = this;
    if(!isConnected()){
      self.log("please connect to node or network before, in order to retrieve necessery information about address prefixing");
      return callback();
    }
    var passphrase = require("bip39").generateMnemonic();
		self.log("Seed    - private:",passphrase);
		self.log("WIF     - private:",sthjs.crypto.getKeys(passphrase).toWIF());
		self.log("Address - public :",sthjs.crypto.getAddress(sthjs.crypto.getKeys(passphrase).publicKey));
		callback();
  });

vorpal
  .command('account vanity <string>', 'Generate an address containing lowercased <string> (WARNING you could wait for long)')
  .action(function(args, callback) {
    var self=this;
    if(!isConnected()){
      self.log("please connect to node or network before, in order to retrieve necessery information about address prefixing");
      return callback();
    }

    var count=0;
    var numCPUs = require('os').cpus().length;
    var cps=[];
    self.log("Spawning process to "+numCPUs+" cpus");
    var spinner = ora({text:"passphrases tested: 0",spinner:"shsth"}).start();
    for (var i = 0; i < numCPUs; i++) {
      var cp=child_process.fork(__dirname+"/vanity.js");
      cps.push(cp);
      cp.on('message', function(message){
        if(message.passphrase){
          spinner.stop();
          var passphrase = message.passphrase;
          self.log("Found after",count,"passphrases tested");
          self.log("Seed    - private:",passphrase);
          self.log("WIF     - private:",sthjs.crypto.getKeys(passphrase).toWIF());
          self.log("Address - public :",sthjs.crypto.getAddress(sthjs.crypto.getKeys(passphrase).publicKey));

          for(var killid in cps){
            cps[killid].kill();
          }
          callback();
        }
        if(message.count){
          count += message.count;
          spinner.text="passphrases tested: "+count;
        }
      });
      cp.send({string:args.string.toLowerCase(), version:network.config.version});
    }

  });

vorpal
  .command('message sign <message>', 'Sign a message')
  .action(function(args, callback) {
    var self = this;
    return this.prompt({
      type: 'password',
      name: 'passphrase',
      message: 'passphrase: ',
    }, function(result){
      if (result.passphrase) {
        var hash = crypto.createHash('sha256');
        hash = hash.update(new Buffer(args.message,"utf-8")).digest();
        self.log("public key: ",sthjs.crypto.getKeys(result.passphrase).publicKey);
        self.log("address   : ",sthjs.crypto.getAddress(sthjs.crypto.getKeys(result.passphrase).publicKey));
        self.log("signature : ",sthjs.crypto.getKeys(result.passphrase).sign(hash).toDER().toString("hex"));

      } else {
        self.log('Aborted.');
        callback();
      }
    });
  });

vorpal
  .command('message verify <message> <publickey>', 'Verify the <message> signed by the owner of <publickey> (you will be prompted to provide the signature)')
  .action(function(args, callback) {
    var self = this;
    return this.prompt({
      type: 'input',
      name: 'signature',
      message: 'signature: ',
    }, function(result){
      if (result.signature) {
        try{
          var hash = crypto.createHash('sha256');
          hash = hash.update(new Buffer(args.message,"utf-8")).digest();
          var signature = new Buffer(result.signature, "hex");
        	var publickey= new Buffer(args.publickey, "hex");
        	var ecpair = sthjs.ECPair.fromPublicKeyBuffer(publickey);
        	var ecsignature = sthjs.ECSignature.fromDER(signature);
        	var res = ecpair.verify(hash, ecsignature);
          self.log(res);
        }
        catch(error){
          self.log("Failed: ", error);
        }
        callback();
      } else {
        self.log('Aborted.');
        callback();
      }
    });

  });
var shsthspinner;
/*
vorpal
  .command("shSTH", "No you don't want to use this command")
  .action(function(args, callback) {
    var self = this;
    self.log(colors.red(figlet.textSync("shSTH")));
    shsthspinner = ora({text:"Watch out, the shSTH attack!",spinner:"shsth"}).start();
    callback();
  });
*/
vorpal
  .command("spSTHaaaaa!")
  .hidden()
  .action(function(args, callback) {
    var time = 0;
    var self=this;
    shsthspinner && shsthspinner.stop();
    ["tux","meow","bunny","cower","dragon-and-cow"].forEach(function(spark){
      setTimeout(function(){
        self.log(cowsay.say({text:"SPAAAASTHKKAAAAAAA!", f:spark}));
  		}, time++*1000);
    });

    callback();
  });

vorpal.history('smartholdem-client');

vorpal.log(colors.cyan(figlet.textSync("SmartHoldem Client","Slant")));

vorpal
  .delimiter('smartholdem>')
  .show();

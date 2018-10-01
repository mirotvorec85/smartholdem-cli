var bip39 = require("bip39");
var sthjs = require("sthjs");

process.on("message", function(message){

  if(message.string){
    sthjs.crypto.setNetworkVersion(message.version);
    var address = "";
    var passphrase;
    var count = 0;
    while(address.toLowerCase().indexOf(message.string) == -1){
      passphrase = bip39.generateMnemonic();
      address = sthjs.crypto.getAddress(sthjs.crypto.getKeys(passphrase).publicKey);
      if(++count == 10){
        count=0;
        process.send({ count: 10 });
      }
    }
    process.send({ passphrase: passphrase });
  }
});

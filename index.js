const crypto = require("crypto");
const https = require("https");

const axios = require("axios");

let Characteristic, Service;

// https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit-TV.ts

module.exports = (homebridge) => {
  Characteristic = homebridge.hap.Characteristic;
  Service = homebridge.hap.Service;
  homebridge.registerAccessory("homebridge-regza", "regza", RegzaAccessory);
}

class RegzaAccessory {
  constructor(log, config) {
    this._log = log;
    this.host = config.host;
    this.user = config.user;
    this.pass = config.pass;

    this._service = new Service.Television("REGZA");
    this._service.getCharacteristic(Characteristic.Active)
      .on('get', this._getActive.bind(this))
      .on('set', this._setActive.bind(this));
    // this._speakerService = new Service.TelevisionSpeaker("REGZA Speaker");
    // this._service.getCharacteristic(Characteristic.Mute)
    //   .on('get', this._getMute.bind(this))
    //   .on('set', this._setMute.bind(this));
    // this._service.getCharacteristic(Characteristic.RemoteKey)
    //   .on('set', this._setRemoteKey.bind(this));
  }

  getServices() {
    const informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, "TOSHIBA")
      .setCharacteristic(Characteristic.Model, "Z720X");

    return [informationService, this._service];
  }

  async _getActive(callback) {
    callback(null, await this._getPowerStatus());
  }

  async _setActive(on, callback) {
    const desiredState = Boolean(on);
    this._log("Setting switch to " + desiredState);
    const currentState = await this._getPowerStatus();
    if (desiredState === currentState) {
      this._log("Already in the desired state, skipping");
      callback();
      return;
    }
    await this._sendKey('40BF12');
    callback();
  }

  // async _getMute(callback) {
  //   callback(null, await this._getMuteStatus());
  // }
  //
  // async _setMute(on, callback) {
  //   const desiredState = Boolean(on);
  //   this._log("Setting switch to " + desiredState);
  //   await this._sendKey('40BF10');
  //   callback();
  // }
  //
  // async _setRemoteKey(key, callback) {
  //   this._log("Remote key: " + key);
  //   callback();
  // }

  // async _getFeature() {
  //   this._log("Getting feature");
  //   const res = await axios({
  //     url: `http://${this.host}/public/feature`,
  //   });
  //   return res.data;
  // }

  async _getPowerStatus() {
    this._log(`Getting power status`);
    const res = await this._sendRequest(`https://${this.host}:4430`, "/v2/remote/play/status");
    const contentType = res.data.content_type;
    if (!contentType) return false;
    return contentType !== "other";
  }

  // async _getMuteStatus() {
  //   this._log("Getting mute status");
  //   const res = await this._sendRequest(`https://${this.host}:4430`, "/v2/remote/status/mute");
  //   const { status, mute } = res.data;
  //   return status === 0 && mute === "on";
  // }

  _md5sum(str) {
    return crypto.createHash('md5').update(str, 'binary').digest('hex');
  }

  async _sendKey(key) {
    return this._sendRequest(`http://${this.host}`, `/remote/remote.htm?key=${key}`);
  }

  // Send HTTP/HTTPS request using Digest authentication
  async _sendRequest(url, path) {
    const fullUrl = url + path;
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
    const res = await axios({
      url: fullUrl,
      httpsAgent,
      validateStatus: (status) => status === 401,
    });
    const digestHeader = res.headers["www-authenticate"];
    const realm = digestHeader.match(/realm="([^"]+)"/)[1];
    const nonce = digestHeader.match(/nonce="([^"]+)"/)[1];
    const a1 = this._md5sum(`${this.user}:${realm}:${this.pass}`);
    const a2 = this._md5sum(`GET:${path}`);
    const nc = "00000001";
    const cnonce = "abc27321496dfe31"
    const response = this._md5sum(`${a1}:${nonce}:${nc}:${cnonce}:auth:${a2}`);
    return axios({
      url: fullUrl,
      httpsAgent,
      headers: {
        authorization: `Digest username="${this.user}", realm="${realm}", nonce="${nonce}", uri="${path}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`,
      },
    });
  }
}

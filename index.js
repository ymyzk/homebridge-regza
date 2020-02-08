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
    this.name = config.name || "REGZA";
    this.host = config.host;
    this.user = config.user;
    this.pass = config.pass;

    this._service = new Service.Television("REGZA");
    this._service.setCharacteristic(Characteristic.ConfiguredName, this.name);
    this._service.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    this._service.getCharacteristic(Characteristic.Active)
      .on('get', this._getActive.bind(this))
      .on('set', this._setActive.bind(this));
    this._service
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .on("set", this._setActiveIdentifier.bind(this));
    this._service
      .getCharacteristic(Characteristic.RemoteKey)
      .on("set", this._setRemoteKey.bind(this));

    this._speakerService = new Service.TelevisionSpeaker("REGZA Volume", "REGZA Speaker");
    this._speakerService.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
    this._speakerService.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.RELATIVE);
    // Not sure how to access this from iOS
    this._speakerService.getCharacteristic(Characteristic.Mute)
      .on('get', this._getMute.bind(this))
      .on('set', this._setMute.bind(this));
    this._speakerService
      .getCharacteristic(Characteristic.VolumeSelector)
      .on('set', this._setVolume.bind(this));
    this._service.addLinkedService(this._speakerService);
  }

  getServices() {
    const informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, "TOSHIBA")
      .setCharacteristic(Characteristic.Model, "Z720X");

    return [informationService, this._service, this._speakerService];
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

  async _setActiveIdentifier(id, callback) {
    this._log("Set active ", id);
    callback();
    ///await this._sendKey('40BF10');
  }

  async _getMute(callback) {
    this._log("Disabling mute");
    callback(null, true);
  }

  async _setMute(on, callback) {
    this._log("Enabling mute");
    const desiredState = Boolean(on);
    await this._sendKey('40BF10');
  }

  async _setVolume(down, callback) {
    this._log(`Setting volume: ${down ? 'down' : 'up'}`);
    await this._sendKey(down ? '40BF1E' : '40BF1A');
    callback();
  }

  async _setRemoteKey(key, callback) {
    const map = {
      [Characteristic.RemoteKey.REWIND]: '',
      [Characteristic.RemoteKey.FAST_FORWARD]: '',
      [Characteristic.RemoteKey.NEXT_TRACK]: '',
      [Characteristic.RemoteKey.PREVIOUS_TRACK]: '',
      [Characteristic.RemoteKey.ARROW_UP]: '40BF3E',
      [Characteristic.RemoteKey.ARROW_DOWN]: '40BF3F',
      [Characteristic.RemoteKey.ARROW_LEFT]: '40BF5F',
      [Characteristic.RemoteKey.ARROW_RIGHT]: '40BF5B',
      [Characteristic.RemoteKey.SELECT]: '40BF3D',
      [Characteristic.RemoteKey.BACK]: '40BF3B',
      [Characteristic.RemoteKey.EXIT]: '',
      [Characteristic.RemoteKey.PLAY_PAUSE]: '40BE2D',
      [Characteristic.RemoteKey.INFORMATION]: '',
    }
    const keyCode = map[key];
    if (keyCode) {
      await this._sendKey(keyCode);
    } else {
      this._log("Cannot send unsupported key: " + key);
    }
    callback();
  }

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

  async _getMuteStatus() {
    this._log("Getting mute status");
    const res = await this._sendRequest(`https://${this.host}:4430`, "/v2/remote/status/mute");
    const { status, mute } = res.data;
    return status === 0 && mute === "on";
  }

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

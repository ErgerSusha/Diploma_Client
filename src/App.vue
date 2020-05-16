<template>
  <div id="app">
    <iframe
      src="https://twilio-bot-web-client-dev.herokuapp.com"
      frameborder="0"
      :class="{'hidden': videoModeOn}"
    ></iframe>

    <a-button
      id="video-toggle-fab"
      @click="videoModeOn = !videoModeOn"
      type="primary"
      ghost
    >Open {{videoModeOn ? 'Chat Bot' : 'Video Calls'}}</a-button>

    <div id="rtc-app" :class="{'hidden': !videoModeOn}">
      <span id="user-nickname">
        <span style="color:#F43751">{{generateNickname(socket.id)}}</span>
        ({{isAdmin ? 'Admin' : 'Client'}})
      </span>
      <span
        id="online-users-info"
        v-if="users.length"
      >Available {{isAdmin ? ' clients' : ' admins'}}:</span>
      <span v-else>Empty, please wait... ⌛</span>
      <transition-group name="list-complete" tag="div">
        <a-button
          v-for="user in users"
          :key="user.id"
          :disabled="user.isCalling"
          class="users-button"
          type="danger"
          @click="callUser(user.id)"
        >{{ generateNickname(user.id) }}</a-button>
      </transition-group>

      <div id="video-group">
        <video id="local-video" ref="localStream" loop autoplay playsinline></video>
        <a-button
          id="hang-up-button"
          @click="hangUp()"
          v-if="callIsOn"
          type="primary"
          shape="circle"
        >X</a-button>
        <video id="remote-video" ref="remoteStream" loop autoplay playsinline></video>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import io from "socket.io-client";
import { Modal } from "ant-design-vue";

interface User {
  id: string;
  isCalling: boolean;
}

interface CallStatus {
  isCalling: boolean;
  callingAdminId?: string;
  callingClientId?: string;
}

interface Offer {
  callerId: string;
  offer: RTCSessionDescriptionInit;
}

@Component
export default class App extends Vue {
  users: User[] = [];
  opponentId: string;
  isAdmin = false;
  rtcConnection: RTCPeerConnection;
  localStream: MediaStream;
  socket: SocketIOClient.Socket;
  callIsOn = false;
  videoModeOn = false;

  created() {
    if (Math.random() > 0.5) {
      this.socket = io.connect("https://diploma-api.herokuapp.com");
    } else {
      this.socket = io.connect("https://diploma-api.herokuapp.com", {
        query: `adminToken=op9eeftt345d34d`
      });
      this.isAdmin = true;
    }

    this.socket.on("init_users", (users: User[]) => {
      this.users = users;
    });
    this.socket.on("user_connected", (id: string) =>
      this.users.push({ id, isCalling: false })
    );
    this.socket.on("user_disconnected", (id: string) =>
      this.users.splice(
        this.users.findIndex(user => user.id === id),
        1
      )
    );
    this.socket.on("user_call_status_changed", (status: CallStatus) => {
      this.users.find(
        user =>
          user.id ===
          (this.isAdmin ? status.callingClientId : status.callingAdminId)
      ).isCalling = status.isCalling;
      this.users = this.users.slice();
    });

    this.socket.on("offer", (data: string) =>
      this.handleOffer(JSON.parse(data))
    );
    this.socket.on("answer", (data: string) =>
      this.rtcConnection.setRemoteDescription(
        new RTCSessionDescription(JSON.parse(data).answer)
      )
    );
    this.socket.on("candidate", (data: string) => {
      if (this.rtcConnection?.remoteDescription) {
        this.rtcConnection.addIceCandidate(
          new RTCIceCandidate(JSON.parse(data).candidate)
        );
      }
    });
    this.socket.on("hangup", () => this.closeConnection());
  }

  sendRtcEvent(data: {
    type: string;
    calleeId: string;
    candidate?: RTCIceCandidate;
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
  }) {
    this.socket.emit("rtcevent", JSON.stringify(data));
  }

  async callUser(userId: string) {
    this.callIsOn = true;
    this.opponentId = userId;
    await this.getMedia(userId);
    const offer = await this.rtcConnection.createOffer();
    await this.rtcConnection.setLocalDescription(offer);
    this.sendRtcEvent({
      type: "offer",
      calleeId: userId,
      offer
    });
  }

  handleOffer(offer: Offer) {
    Modal.confirm({
      title: this.generateNickname(offer.callerId) + " is calling. Answer?",
      onOk: () => {
        this.answerCall(offer);
      },
      onCancel: () => {
        this.sendRtcEvent({
          type: "hangup",
          calleeId: offer.callerId
        });
      }
    });
  }

  async answerCall(offer: Offer) {
    if (!this.videoModeOn) {
      this.videoModeOn = true;
    }
    this.callIsOn = true;
    this.opponentId = offer.callerId;
    await this.getMedia(offer.callerId);
    await this.rtcConnection.setRemoteDescription(
      new RTCSessionDescription(offer.offer)
    );

    const answer = await this.rtcConnection.createAnswer();
    await this.rtcConnection.setLocalDescription(answer);
    this.sendRtcEvent({
      type: "answer",
      calleeId: offer.callerId,
      answer
    });
  }

  async getMedia(calleeId: string) {
    this.rtcConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    (this.$refs.localStream as HTMLVideoElement).srcObject = stream;
    this.localStream = stream;

    this.rtcConnection.ontrack = ev =>
      ((this.$refs.remoteStream as HTMLVideoElement).srcObject = ev.streams[0]);

    stream
      .getTracks()
      .forEach(track => this.rtcConnection.addTrack(track, stream));

    this.rtcConnection.onicecandidate = event => {
      if (event.candidate) {
        this.sendRtcEvent({
          type: "candidate",
          calleeId,
          candidate: event.candidate
        });
      }
    };
  }

  hangUp() {
    this.sendRtcEvent({
      type: "hangup",
      calleeId: this.opponentId
    });
    this.closeConnection();
  }

  closeConnection() {
    (this.$refs.remoteStream as HTMLVideoElement).srcObject = null;
    (this.$refs.localStream as HTMLVideoElement).srcObject = null;

    this.localStream.getTracks().forEach(track => track.stop());
    this.localStream = null;
    this.rtcConnection.close();

    this.callIsOn = false;
  }

  generateNickname(userId: string): string {
    if (!userId) {
      return "";
    }
    let sum = 0;
    for (let i = 0; i < userId.length; i++) {
      sum += userId.charAt(i).charCodeAt(0);
    }
    switch (sum % 10) {
      case 0:
        return "Funny Koala";
      case 1:
        return "Strange Tiger";
      case 2:
        return "Little Elephant";
      case 3:
        return "Huge Bee";
      case 4:
        return "Purple Lion";
      case 5:
        return "Gorgeous Lizard";
      case 6:
        return "Weird Wolf";
      case 7:
        return "Tiny Buffalo";
      case 8:
        return "Red Bear";
      case 9:
        return "Spanish Tasmanian Devil";
    }
  }
}
</script>

<style>
body {
  margin: 0;
  display: flex;
  height: 100vh;
}

iframe {
  height: calc(100% - 48px);
  width: 100%;
  position: absolute;
  top: 48px;
  left: 0;
  z-index: 1;
  transition: opacity 0.3s ease;
}

.hidden {
  opacity: 0;
  z-index: -1;
}

#app {
  width: 100%;
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}

#video-group {
  grid-template-columns: 1fr 1fr;
}

#hang-up-button {
  position: absolute;
  bottom: 24px;
  left: 24px;
}

#video-toggle-fab {
  height: 32px;
  margin: 8px 0;
  z-index: 2;
}

#local-video {
  width: calc(33vw - 32px);
  position: absolute;
  bottom: 16px;
  right: 16px;
  border-bottom-right-radius: 8px;
  border-top-left-radius: 8px;
}

#remote-video {
  width: calc(100vw - 32px);
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: -1;
  border-radius: 8px;
}

@media (min-width: 992px) {
  #remote-video {
    max-width: 1048px;
  }
}

#rtc-app {
  height: calc(100% - 48px);
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  transition: opacity 0.3s ease;
}

#user-nickname {
  font-weight: bold;
  font-size: 22px;
  margin-bottom: 8px;
}

#online-users-info {
  font-weight: bold;
  justify-self: start;
  margin-left: 16px;
  text-decoration: underline;
}

.users-button {
  margin: 4px;
  font-weight: bold !important;
}

.list-complete-enter,
.list-complete-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

.list-complete-leave-active {
  position: absolute;
}
</style>

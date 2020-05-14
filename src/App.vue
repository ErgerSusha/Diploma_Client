<template>
  <div id="app">
    <iframe
      src="https://tribe-webapp-dev.herokuapp.com"
      frameborder="0"
      :class="{'hidden': videoModeOn}"
    ></iframe>

    <img
      id="video-toggle-fab"
      @click="videoModeOn = !videoModeOn"
      :src="videoModeOn ? '/assets/close.svg' : '/assets/call.svg'"
    />

    <div id="rtc-app" :class="{'hidden': !videoModeOn}">
      <h4>
        {{isAdmin ? ' Admin' : 'Client'}}
        <i>{{generateNickname(socket.id)}}</i>
      </h4>
      <h5 v-if="users.length">Available {{isAdmin ? ' clients' : ' admins'}}</h5>
      <h5 v-else>Empty, please wait... ⌛</h5>
      <transition-group name="list-complete" tag="div">
        <div
          v-for="user in users"
          :key="user.id"
          :class="{'is-calling': user.isCalling }"
          class="users-button"
          @click="callUser(user.id)"
        >{{ generateNickname(user.id) }}</div>
      </transition-group>

      <video id="local-video" ref="localStream" loop autoplay playsinline></video>
      <img
        id="hang-up-button"
        @click="hangUp()"
        v-if="callIsOn"
        src="/assets/call.svg"
        title="End call"
      />
      <video id="remote-video" ref="remoteStream" loop autoplay playsinline></video>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import io from "socket.io-client";

interface User {
  id: string;
  isCalling: boolean;
}

interface CallStatus {
  isCalling: boolean;
  callingAdminId?: string;
  callingClientId?: string;
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
      this.socket = io.connect("http://192.168.0.104:3000");
    } else {
      this.socket = io.connect("http://192.168.0.104:3000", {
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
      if (this.rtcConnection.remoteDescription) {
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

  async handleOffer(data: {
    callerId: string;
    offer: RTCSessionDescriptionInit;
  }) {
    const accepted = confirm(
      this.generateNickname(data.callerId) + " is calling. Answer?"
    );
    if (accepted) {
      if (!this.videoModeOn) {
        this.videoModeOn = true;
      }
      this.callIsOn = true;
      this.opponentId = data.callerId;
      await this.getMedia(data.callerId);
      await this.rtcConnection.setRemoteDescription(
        new RTCSessionDescription(data.offer)
      );

      const answer = await this.rtcConnection.createAnswer();
      await this.rtcConnection.setLocalDescription(answer);
      this.sendRtcEvent({
        type: "answer",
        calleeId: data.callerId,
        answer
      });
    }
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
  height: 100%;
  width: 100vw;
  position: absolute;
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

#hang-up-button {
  border-radius: 50%;
  width: 5vw;
  height: 5vw;
  padding: 8px;
  background: mediumaquamarine;
  cursor: pointer;
  position: absolute;
  bottom: calc(15% + 32px);
  left: calc(15% + 32px);
}

#video-toggle-fab {
  background: mediumaquamarine;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  position: absolute;
  bottom: 40px;
  left: 40px;
  padding: 16px;
  z-index: 2;
  box-shadow: 0 1px 3px rgba(124, 111, 111, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
  transition: transform 0.25s ease-in-out;
  cursor: pointer;
}

#video-toggle-fab:hover {
  transform: scale(1.15);
}

#rtc-app {
  transition: opacity 0.3s ease;
}

.users-button {
  outline: none;
  background: mediumaquamarine;
  color: #fff;
  border-radius: 8px;
  height: 40px;
  line-height: 40px;
  font-weight: bold;
  width: max-content;
  margin: 16px;
  padding: 0 8px;
  display: inline-block;
  align-items: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(124, 111, 111, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
  transition: box-shadow 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
    transform 0.5s ease-in-out, opacity 0.5s ease-in-out, background 0.5s ease;
}

.users-button:hover {
  box-shadow: 0 6px 10px rgba(0, 0, 0, 0.25), 0 4px 4px rgba(0, 0, 0, 0.22);
}

.is-calling {
  pointer-events: none;
  background: #999;
}

.list-complete-enter,
.list-complete-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

.list-complete-leave-active {
  position: absolute;
}

video {
  position: absolute;
  bottom: 15%;
}

#local-video {
  width: 25%;
  right: 15%;
}

#remote-video {
  width: 70%;
  left: 15%;
  z-index: -1;
}
</style>

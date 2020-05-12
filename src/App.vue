<template>
  <div id="app">
    <video id="local-stream" loop autoplay playsinline></video>
    <video id="remote-stream" loop autoplay playsinline></video>
    <h3>{{isAdmin ? ' Admin' : 'Client'}}</h3>
    <h5 v-if="users.length">Available {{isAdmin ? ' clients' : ' admins'}}</h5>
    <h5 v-else>Empty, please wait... ⌛</h5>
    <transition-group name="list-complete" tag="div">
      <div v-for="user in users" :key="user" class="users-button" @click="callUser(user)">{{ user }}</div>
    </transition-group>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import io from "socket.io-client";

@Component
export default class App extends Vue {

  users: string[] = [];
  isAdmin = false;
  rtcConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });
  socket!: SocketIOClient.Socket;

  created() {
    const rand = Math.random();
    if (rand > 0.5) {
      this.socket = io.connect("https://diploma-api.herokuapp.com");
    } else {
      this.socket = io.connect("https://diploma-api.herokuapp.com", {
        query: `adminToken=op9eeftt345d34d`
      });
      this.isAdmin = true;
    }

    this.socket.on("init_users", (users: string[]) => (this.users = users));
    this.socket.on("user_connected", (userId: string) => this.users.push(userId));
    this.socket.on("user_disconnected", (userId: string) =>
      this.users.splice(this.users.indexOf(userId), 1)
    );

    this.socket.on("offer", (data: string) => this.handleOffer(JSON.parse(data)));
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
    await this.getMedia(userId);
    const offer = await this.rtcConnection.createOffer();
    await this.rtcConnection.setLocalDescription(offer);
    this.sendRtcEvent({
      type: "offer",
      calleeId: userId,
      offer
    });
  }

  async handleOffer(data: { callerId: string; offer: RTCSessionDescriptionInit }) {
    const accepted = confirm(data.callerId + " is calling. Answer?");
    if (accepted) {
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
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    (document.getElementById("local-stream") as HTMLVideoElement).srcObject = stream;

    stream
      .getTracks()
      .forEach(track => this.rtcConnection.addTrack(track, stream));

    this.rtcConnection.ontrack = ev =>
      (document.getElementById("remote-stream") as HTMLVideoElement).srcObject = ev.streams[0];

    this.rtcConnection.onicecandidate = event => {
      if (event.candidate) {
        this.sendRtcEvent({
          type: "candidate",
          calleeId,
          candidate: event.candidate
        })
      }
    };
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
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
    transform 0.5s ease-in-out, opacity 0.5s ease-in-out;
}

.users-button:hover {
  box-shadow: 0 6px 10px rgba(0, 0, 0, 0.25), 0 4px 4px rgba(0, 0, 0, 0.22);
}

.list-complete-enter,
.list-complete-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

.list-complete-leave-active {
  position: absolute;
}

video {
  max-width: 50%;
}
</style>

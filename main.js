import './style.css'

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";

// Your web app's Firebase configuration
const firebaseConfig = {
  // your config
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

import { getFirestore, collection, addDoc, doc, setDoc, onSnapshot, getDoc, updateDoc } from "firebase/firestore";

const firestore = getFirestore(app);

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

let pc = new RTCPeerConnection(servers);

let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();

  // push tracks from local stream to peer connection
  localStream.getTracks().forEach(track => {
    console.log("local track added:", track);
    pc.addTrack(track, localStream);
  });

  // pull tracked from remote stream, add to video stream
  pc.ontrack = event => {
    console.log("remote track event:", event);
    event.streams[0].getTracks().forEach(track => {
      console.log("remote track added:", track);
      remoteStream.addTrack(track);
      console.log("Number of tracks:", remoteStream.getTracks().length);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;

  console.log("local video started!");
}

// create an offer
callButton.onclick = async () => {
  const callDoc = doc(collection(firestore, "calls"));
  const offerCandidates = collection(callDoc, "offerCandidates");
  const answerCandidates = collection(callDoc, "answerCandidates");

  callInput.value = callDoc.id;

  // get candidates for caller, save to db
  pc.onicecandidate = async event => {
    console.log("local ice candidates event:", event);
    event.candidate && (await addDoc(offerCandidates, event.candidate.toJSON()));
  };

  // create offer
  console.log("creating offer...");
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await setDoc(callDoc, { offer });

  // listen for remote answer
  onSnapshot(callDoc, snapshot => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      console.log("accepting remote answer...");
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // when answered, add candidate to peer connection
  onSnapshot(answerCandidates, snapshot => {
    console.log("remote ice candidates added");
    snapshot.docChanges().forEach(change => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        console.log("candidate: ", change.doc.data());
        // add remote ice candidates
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
}

// answer the call with unique id
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = doc(collection(firestore, "calls"), callId);
  const answerCandidates = collection(callDoc, "answerCandidates");
  const offerCandidates = collection(callDoc, 'offerCandidates');

  pc.onicecandidate = async event => {
    console.log("local ice candidates event:", event);
    event.candidate && (await addDoc(answerCandidates, event.candidate.toJSON()));
  };

  console.log("setRemoteDescription...");
  const callData = (await getDoc(callDoc)).data();
  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  console.log("setLocalDescription...");
  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await updateDoc(callDoc, { answer });

  onSnapshot(offerCandidates, snapshot => {
    snapshot.docChanges().forEach(change => {
      console.log("remote ice candidates added");
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        console.log("candidate: ", change.doc.data());
        // add remote ice candidates
        pc.addIceCandidate(candidate);
      }
    });
  });
};
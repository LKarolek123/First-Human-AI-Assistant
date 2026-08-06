export type RealtimeOffer = {
    peerConnection: RTCPeerConnection;
    localStream: MediaStream;
    dataChannel: RTCDataChannel;
    sdpOffer: string;
}
/** zwraca realtime offer, ktory zamiera sdpOffer, mikrofon i polaczenie RTC */
export async function createRealtimeOffer(): Promise<RealtimeOffer> {
    const localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
    });


    const peerConnection = new RTCPeerConnection();


    for (const track of localStream.getTracks()) {
        peerConnection.addTrack(track, localStream);
    }
     const dataChannel = peerConnection.createDataChannel('oai-events');
    const offer =  await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
        throw new Error('WebRTC offer does not contain SDP.');
    }

    return {
        peerConnection,
        localStream,
        dataChannel,
        sdpOffer: offer.sdp,
    };
    
}
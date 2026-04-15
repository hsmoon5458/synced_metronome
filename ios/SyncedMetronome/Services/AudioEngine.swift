import AVFoundation
import Foundation

class AudioEngine {
    private var audioEngine: AVAudioEngine
    private var playerNode: AVAudioPlayerNode
    private var accentBuffer: AVAudioPCMBuffer?
    private var normalBuffer: AVAudioPCMBuffer?
    private let sampleRate: Double = 44100

    init() {
        audioEngine = AVAudioEngine()
        playerNode = AVAudioPlayerNode()
        setupAudio()
        buildClickBuffers()
    }

    private func setupAudio() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)

        // Use a low buffer duration for minimal latency
        try? session.setPreferredIOBufferDuration(0.005)

        audioEngine.attach(playerNode)

        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: format)

        try? audioEngine.start()
        playerNode.play()
    }

    private func buildClickBuffers() {
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

        // Normal click: short noise burst + tone
        let normalLen = Int(sampleRate * 0.05)
        if let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(normalLen)) {
            buffer.frameLength = AVAudioFrameCount(normalLen)
            let data = buffer.floatChannelData![0]
            for i in 0..<normalLen {
                let noise = Float.random(in: -1...1) * exp(Float(-i) / 200)
                let tone = sin(Float(i) * 2 * .pi * 1000 / Float(sampleRate)) * 5.0 * exp(Float(-i) / (Float(sampleRate) * 0.05))
                data[i] = (noise + tone) * 0.3
            }
            normalBuffer = buffer
        }

        // Accent click: louder, slightly longer
        let accentLen = Int(sampleRate * 0.08)
        if let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(accentLen)) {
            buffer.frameLength = AVAudioFrameCount(accentLen)
            let data = buffer.floatChannelData![0]
            for i in 0..<accentLen {
                let noise = Float.random(in: -1...1) * exp(Float(-i) / 140)
                let tone = sin(Float(i) * 2 * .pi * 1500 / Float(sampleRate)) * 10.0 * exp(Float(-i) / (Float(sampleRate) * 0.09))
                data[i] = (noise + tone) * 0.4
            }
            accentBuffer = buffer
        }
    }

    func scheduleClick(at time: AVAudioTime?, isAccent: Bool) {
        guard let buffer = isAccent ? accentBuffer : normalBuffer else { return }
        if let time = time {
            playerNode.scheduleBuffer(buffer, at: time, options: [], completionHandler: nil)
        } else {
            playerNode.scheduleBuffer(buffer, completionHandler: nil)
        }
    }

    func scheduleClickNow(isAccent: Bool) {
        scheduleClick(at: nil, isAccent: isAccent)
    }

    var currentTime: Double {
        guard let nodeTime = playerNode.lastRenderTime,
              let playerTime = playerNode.playerTime(forNodeTime: nodeTime) else {
            return 0
        }
        return Double(playerTime.sampleTime) / playerTime.sampleRate
    }

    func audioTime(afterSeconds seconds: Double) -> AVAudioTime? {
        guard let nodeTime = playerNode.lastRenderTime else { return nil }
        let sampleTime = nodeTime.sampleTime + AVAudioFramePosition(seconds * sampleRate)
        return AVAudioTime(sampleTime: sampleTime, atRate: sampleRate)
    }

    var outputLatency: Double {
        return AVAudioSession.sharedInstance().outputLatency
    }

    func stop() {
        playerNode.stop()
        audioEngine.stop()
    }

    func restart() {
        if !audioEngine.isRunning {
            try? audioEngine.start()
        }
        if !playerNode.isPlaying {
            playerNode.play()
        }
    }
}

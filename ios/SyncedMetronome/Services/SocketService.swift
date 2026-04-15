import Foundation
import SocketIO

class SocketService {
    static let serverURL = "https://synced-metronome.onrender.com"

    private var manager: SocketManager?
    private var socket: SocketIOClient?

    var onSync: ((SyncData) -> Void)?
    var onClientCount: ((Int) -> Void)?
    var onHostAvailability: ((Bool) -> Void)?
    var onHostStatus: ((Bool, String) -> Void)?
    var onConnect: (() -> Void)?
    var onDisconnect: (() -> Void)?

    func connect() {
        guard let url = URL(string: Self.serverURL) else { return }

        manager = SocketManager(socketURL: url, config: [
            .log(false),
            .compress,
            .forceWebsockets(true),
            .reconnects(true),
            .reconnectWait(2),
            .reconnectWaitMax(10)
        ])

        socket = manager?.defaultSocket
        setupHandlers()
        socket?.connect()
    }

    private func setupHandlers() {
        guard let socket = socket else { return }

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.onConnect?()
            }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.onDisconnect?()
            }
        }

        socket.on("sync") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any] else { return }
            let syncData = SyncData(
                bpm: dict["bpm"] as? Int ?? 120,
                startTime: dict["startTime"] as? Double,
                isRunning: dict["isRunning"] as? Bool ?? false,
                timeSignature: dict["timeSignature"] as? String ?? "4/4",
                subdivision: dict["subdivision"] as? Int ?? 2
            )
            DispatchQueue.main.async {
                self?.onSync?(syncData)
            }
        }

        socket.on("clientCount") { [weak self] data, _ in
            guard let count = data.first as? Int else { return }
            DispatchQueue.main.async {
                self?.onClientCount?(count)
            }
        }

        socket.on("hostAvailability") { [weak self] data, _ in
            guard let available = data.first as? Bool else { return }
            DispatchQueue.main.async {
                self?.onHostAvailability?(available)
            }
        }

        socket.on("hostStatus") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let isHost = dict["isHost"] as? Bool,
                  let message = dict["message"] as? String else { return }
            DispatchQueue.main.async {
                self?.onHostStatus?(isHost, message)
            }
        }
    }

    func identify(role: String) {
        socket?.emit("identify", role)
    }

    func updateSettings(bpm: Int, timeSignature: String, subdivision: Int, startTime: Double? = nil) {
        var payload: [String: Any] = [
            "bpm": bpm,
            "timeSignature": timeSignature,
            "subdivision": subdivision
        ]
        if let startTime = startTime {
            payload["startTime"] = startTime
        }
        socket?.emit("updateSettings", payload)
    }

    func startMetronome() {
        socket?.emit("startMetronome")
    }

    func stopMetronome() {
        socket?.emit("stopMetronome")
    }

    func disconnect() {
        socket?.disconnect()
        manager = nil
    }

    var isConnected: Bool {
        return socket?.status == .connected
    }
}

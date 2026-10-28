// Spike for lionel509/Ghostwriter#3: plain text continuation with Apple's on-device
// FoundationModels. Reads {"id","prefix"} JSON lines on stdin, writes one result line each.
// Build: see README.md in this folder.

import Foundation
import FoundationModels

let instructionsA = "You are an autocomplete engine. Continue the user's text with the next few words only (one short phrase, at most one sentence). Output only the continuation. Never repeat the given text, never add quotes, labels, or commentary."
let instructionsB = "Complete the text."

var variant = "A"
let argv = CommandLine.arguments
if let i = argv.firstIndex(of: "--variant"), i + 1 < argv.count {
    variant = argv[i + 1]
}
guard variant == "A" || variant == "B" else {
    FileHandle.standardError.write("usage: continue [--variant A|B] < prefixes.jsonl\n".data(using: .utf8)!)
    exit(2)
}

let instructions = variant == "A" ? instructionsA : instructionsB
let model = SystemLanguageModel.default

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.withoutEscapingSlashes]),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func describeAvailability() -> String? {
    switch model.availability {
    case .available:
        return nil
    case .unavailable(let reason):
        return "unavailable: \(reason)"
    }
}

let availabilityError = describeAvailability()

// Prewarm once, before any timed call. The first timed call is still reported as cold.
if availabilityError == nil {
    let warmSession = LanguageModelSession(model: model, instructions: instructions)
    warmSession.prewarm()
}

var isFirst = true
while let line = readLine() {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { continue }

    guard let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let prefix = obj["prefix"] as? String else {
        emit(["id": NSNull(), "variant": variant, "ms": 0, "output": NSNull(),
              "error": "bad input line", "cold": false])
        continue
    }
    let id: Any = obj["id"] ?? NSNull()

    if let availabilityError = availabilityError {
        emit(["id": id, "variant": variant, "ms": 0, "output": NSNull(),
              "error": availabilityError, "cold": isFirst])
        isFirst = false
        continue
    }

    // Variant A: the prefix is the user prompt. Variant B: labelled prompt.
    let prompt = variant == "A" ? prefix : "Text: \(prefix)\nContinuation:"
    let options = GenerationOptions(temperature: 0.2, maximumResponseTokens: 24)
    let session = LanguageModelSession(model: model, instructions: instructions)

    let t0 = DispatchTime.now().uptimeNanoseconds
    var output: Any = NSNull()
    var errorText: Any = NSNull()
    do {
        let response = try await session.respond(to: prompt, options: options)
        output = response.content
    } catch {
        errorText = "\(error) | \(error.localizedDescription)"
    }
    let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000

    emit(["id": id, "variant": variant, "ms": (elapsedMs * 10).rounded() / 10,
          "output": output, "error": errorText, "cold": isFirst])
    isFirst = false
}

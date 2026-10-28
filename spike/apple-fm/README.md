# Apple Foundation Models continuation spike (lionel509/Ghostwriter#3)

A measurement spike, not a feature. `continue.swift` reads `{"id","prefix"}` JSON lines on stdin and prints one result line per input: `{"id","variant","ms","output","error","cold"}`.

## Build

From this folder:

```
/Library/Developer/CommandLineTools/usr/bin/swiftc -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk -target arm64-apple-macos27.0 -O continue.swift -o continue
```

## Run

```
./continue --variant A < prefixes.jsonl > results-A.jsonl
./continue --variant B < prefixes.jsonl > results-B.jsonl
```

Variant A: instructions are the autocomplete-engine prompt, user prompt is the prefix itself. Variant B: instructions are "Complete the text.", user prompt is `Text: <prefix>` plus a `Continuation:` line. Each input gets a fresh `LanguageModelSession`. `GenerationOptions(temperature: 0.2, maximumResponseTokens: 24)`. `prewarm()` runs once before the loop, and the first timed call is flagged `"cold": true`.

`prefixes.jsonl` and `results-*.jsonl` are gitignored because they hold local note excerpts.

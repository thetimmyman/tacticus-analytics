#!/usr/bin/env python3
"""Run real Xcode/Simulator tests; emit only scoped, synthetic evidence."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time

ROOT = Path(__file__).resolve().parents[4]
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--sha", required=True)
args = parser.parse_args()
if not args.output.is_absolute() or len(args.sha) != 40 or any(c not in "0123456789abcdef" for c in args.sha):
    raise SystemExit("An absolute disposable output directory and full source SHA are required")
args.output.mkdir(parents=True, exist_ok=False)
started = datetime.now(timezone.utc).isoformat()

def run(command, *, timeout=1200, log=None):
    if log:
        with log.open("w") as output:
            result = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
        if result.returncode:
            # Native compiler errors are useful; avoid printing system inventory or identifiers.
            errors = [line for line in log.read_text(errors="replace").splitlines() if " error:" in line or "failed" in line.lower()]
            print("\n".join(errors[-30:]))
            raise RuntimeError("Native build/test failed; the raw diagnostic log remains local to this job")
        return ""
    return subprocess.check_output(command, cwd=ROOT, timeout=timeout, text=True)

measurements = []
created = []
try:
    run(["python3", "apps/mobile/ios/scripts/generate-project.py"])
    xcode = run(["xcodebuild", "-version"]).strip()
    devices = json.loads(run(["xcrun", "simctl", "list", "devices", "available", "-j"]))["devices"]
    runtimes = [(runtime, values) for runtime, values in devices.items() if ".iOS-" in runtime and values]
    if not runtimes:
        raise RuntimeError("No available iOS Simulator runtime")
    runtime, available = sorted(runtimes, reverse=True)[0]
    selected = []
    for family in ["iPhone", "iPad"]:
        candidates = [device for device in available if device["name"].startswith(family)]
        if not candidates:
            raise RuntimeError("Both iPhone and iPad Simulator capacity are required")
        selected.append((family, candidates[0]))
    derived = args.output / "derived"
    project = ["-project", "apps/mobile/ios/TacticusIOS.xcodeproj", "-scheme", "TacticusIOS", "-derivedDataPath", str(derived)]
    for family, device in selected:
        print("Preparing disposable " + family + " Simulator", flush=True)
        # A new disposable Simulator is isolated from any pre-existing runner state.
        types = json.loads(run(["xcrun", "simctl", "list", "devicetypes", "-j"]))["devicetypes"]
        device_type = next(item["identifier"] for item in types if item["name"] == device["name"])
        udid = run(["xcrun", "simctl", "create", "Synthetic workspace proof", device_type, runtime]).strip()
        created.append(udid)
        run(["xcrun", "simctl", "boot", udid])
        run(["xcrun", "simctl", "bootstatus", udid, "-b"], timeout=240)
        began = time.monotonic()
        print("Running native tests on " + family + " Simulator", flush=True)
        run(["xcodebuild", *project, "-destination", f"platform=iOS Simulator,id={udid}", "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1", "test"], log=args.output / (family + "-diagnostic.log"))
        diagnostics = (args.output / (family + "-diagnostic.log")).read_text(errors="replace").splitlines()
        for name in ["testOfflineSQLiteCalculationAndReopen", "testActualSQLiteFullRollbackRetainsPreviousDocument", "testRealSimulatorKeychainCRUDAndCanaryGuard", "testAllThreeSyntheticScopesReuseOneReferenceAndRealShapeProjection", "testInstalledSyntheticOfflineWriteAndProcessRelaunch", "testFreshPersonalWorkspaceRequiresPlayerAndSecureInput"]:
            if not any(name in line and "passed" in line.lower() for line in diagnostics):
                raise RuntimeError("Required native test did not report a pass: " + name)
        elapsed = round(time.monotonic() - began, 3)
        measurements.append({"family": family, "classification": "simulator", "testBuildSeconds": elapsed, "tests": "native SQLite/Keychain and synthetic onboarding doubles; installed UI offline row save/process relaunch"})
        print(family + " Simulator native tests passed in " + str(elapsed) + " seconds", flush=True)
        run(["xcrun", "simctl", "shutdown", udid])
    began = time.monotonic()
    run(["xcodebuild", *project, "-configuration", "Release", "-destination", "generic/platform=iOS Simulator", "build"], log=args.output / "release-diagnostic.log")
    # Bind acceptance to the Debug app actually installed by XCTest, not a later build.
    app = derived / "Build/Products/Debug-iphonesimulator/TacticusIOS.app"
    artifact = args.output / "tacticus-ios-simulator.zip"
    run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(artifact)])
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    # The fixed fixture identifies the synthetic demo only, not live Player verification.
    fixture = (ROOT / "apps/mobile/ios/Resources/synthetic-demo.json").read_bytes()
    completed = datetime.now(timezone.utc).isoformat()
    evidence = {
        "schemaVersion": "platform-evidence/v1", "evidenceKind": "product-acceptance", "runId": "ios-simulator-synthetic-v1",
        "build": {"sha": args.sha, "artifact": {"sha256": digest, "format": "simulator-app-zip"}},
        "environment": {"os": "ios", "osVersion": runtime.rsplit("iOS-", 1)[-1].replace("-", "."), "arch": platform.machine(), "classification": "simulator", "runtimeVersions": {"xcode": xcode}, "installation": "clean-install"},
        "fixture": {"id": "mobile-synthetic-v1", "sha256": hashlib.sha256(fixture).hexdigest()},
        "scenario": {"id": "restart-persistence", "expected": "Installed synthetic demo row and integer calculation survive process relaunch on phone and tablet Simulators"},
        "startedAt": started, "completedAt": completed,
        "outcome": {"status": "pass", "actual": "Both fresh phone/tablet Simulators passed the installed UI save/relaunch tests plus native unit checks", "blockers": []},
        "assertions": [{"id": "installed-synthetic-save-relaunch", "status": "pass", "expected": "Same saved analytics after terminate/launch and background/foreground", "actual": "XCTest assertions passed on both Simulator families"}], "attachments": []
    }
    (args.output / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    report = {"schemaVersion": "mobile-measurement/v1", "candidate": "UIKit/Swift/system-SQLite/Keychain", "measurements": measurements,
              "releaseBuildSeconds": round(time.monotonic() - began, 3), "simulatorArtifactBytes": artifact.stat().st_size,
              "scope": "Synthetic installed Simulator slice; onboarding source/vault doubles are separate from real Simulator Keychain CRUD",
              "externalGates": ["Owner-provided physical iPhone/iPad and provisioning/signing", "Physical file protection, airplane/suspend/thermal/storage/release upgrade/uninstall", "Authorized real-key onboarding qualification with stable ownership limitations", "Full existing feature parity and full archive export beyond mobile core v1", "Reviewed contribution binding/envelope/transport"]}
    (args.output / "measurements.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output / "artifact.sha256").write_text(digest + "  tacticus-ios-simulator.zip\n")
    print(json.dumps(report))
finally:
    for udid in created:
        subprocess.run(["xcrun", "simctl", "shutdown", udid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["xcrun", "simctl", "delete", udid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

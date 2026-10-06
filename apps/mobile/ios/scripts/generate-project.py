#!/usr/bin/env python3
"""Generate the dependency-free Xcode project deterministically."""
import hashlib
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
objects = {}

def identifier(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

def add(identity, isa, **fields):
    key = identifier(identity)
    objects[key] = {"isa": isa, **fields}
    return key

def atom(value):
    if isinstance(value, dict):
        return "{ " + " ".join(f"{json.dumps(k)} = {atom(v)};" for k, v in value.items()) + " }"
    if isinstance(value, list):
        return "( " + ", ".join(atom(v) for v in value) + ", )" if value else "()"
    return json.dumps(str(value))

targets, products, references = [], [], []
target_ids = {name: identifier(name) for name in ["TacticusIOS", "WorkspaceTests", "WorkspaceUITests"]}
for name, sources, kind in [
    ("TacticusIOS", [str(p.relative_to(ROOT)) for p in sorted((ROOT / "Sources").glob("*.swift"))], "application"),
    ("WorkspaceTests", ["../../../tests/mobile/ios/WorkspaceTests.swift"], "bundle.unit-test"),
    ("WorkspaceUITests", ["../../../tests/mobile/ios/WorkspaceUITests.swift"], "bundle.ui-testing")
]:
    builds = []
    for source in sources:
        ref = add(source, "PBXFileReference", lastKnownFileType="sourcecode.swift", path=source, sourceTree="SOURCE_ROOT")
        references.append(ref)
        builds.append(add("build-" + source, "PBXBuildFile", fileRef=ref))
    extension = "app" if kind == "application" else "xctest"
    product = add(name + "-product", "PBXFileReference", explicitFileType="wrapper.application" if kind == "application" else "wrapper.cfbundle", path=f"{name}.{extension}", sourceTree="BUILT_PRODUCTS_DIR")
    products.append(product)
    resources = []
    if kind == "application":
        source = "Resources/synthetic-demo.json"
        ref = add(source, "PBXFileReference", lastKnownFileType="text.json", path=source, sourceTree="SOURCE_ROOT")
        references.append(ref)
        resources.append(add("build-" + source, "PBXBuildFile", fileRef=ref))
    phases = [add(name + "-sources", "PBXSourcesBuildPhase", buildActionMask=2147483647, files=builds, runOnlyForDeploymentPostprocessing=0),
              add(name + "-frameworks", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0),
              add(name + "-resources", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=resources, runOnlyForDeploymentPostprocessing=0)]
    configs = []
    for mode in ["Debug", "Release"]:
        settings = {"PRODUCT_NAME": name, "PRODUCT_BUNDLE_IDENTIFIER": "com.tacticusanalytics.mobile.ios" + ("." + name if kind != "application" else ""),
                    "SWIFT_VERSION": "5.0", "IPHONEOS_DEPLOYMENT_TARGET": "17.0", "TARGETED_DEVICE_FAMILY": "1,2",
                    "GENERATE_INFOPLIST_FILE": "YES", "CODE_SIGN_STYLE": "Automatic", "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
                    "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if mode == "Debug" else "-O", "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
                    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG" if mode == "Debug" else "", "ENABLE_TESTABILITY": "YES" if mode == "Debug" else "NO"}
        if kind == "application":
            settings.update({"INFOPLIST_KEY_CFBundleDisplayName": "Tacticus workspace", "INFOPLIST_KEY_UILaunchScreen_Generation": "YES",
                             "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES", "INFOPLIST_KEY_UISupportedInterfaceOrientations": "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight",
                             "MARKETING_VERSION": "0.1.0", "CURRENT_PROJECT_VERSION": "1", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks", "OTHER_LDFLAGS": "$(inherited) -lsqlite3"})
        elif kind == "bundle.unit-test":
            settings.update({"TEST_HOST": "$(BUILT_PRODUCTS_DIR)/TacticusIOS.app/TacticusIOS", "BUNDLE_LOADER": "$(TEST_HOST)", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @loader_path/Frameworks", "OTHER_LDFLAGS": "$(inherited) -lsqlite3"})
        else:
            settings.update({"TEST_TARGET_NAME": "TacticusIOS", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @loader_path/Frameworks"})
        configs.append(add(name + mode, "XCBuildConfiguration", name=mode, buildSettings=settings))
    configlist = add(name + "-configs", "XCConfigurationList", buildConfigurations=configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
    dependencies = []
    if kind != "application":
        proxy = add(name + "-proxy", "PBXContainerItemProxy", containerPortal=identifier("project"), proxyType=1, remoteGlobalIDString=target_ids["TacticusIOS"], remoteInfo="TacticusIOS")
        dependencies = [add(name + "-dependency", "PBXTargetDependency", target=target_ids["TacticusIOS"], targetProxy=proxy)]
    targets.append(add(name, "PBXNativeTarget", buildConfigurationList=configlist, buildPhases=phases, buildRules=[], dependencies=dependencies, name=name, productName=name, productReference=product, productType="com.apple.product-type." + kind))

products_group = add("products", "PBXGroup", children=products, name="Products", sourceTree="<group>")
main = add("main-group", "PBXGroup", children=references + [products_group], sourceTree="<group>")
configs = [add("project-" + mode, "XCBuildConfiguration", name=mode, buildSettings={"SDKROOT": "iphoneos", "CLANG_ENABLE_MODULES": "YES", "CLANG_ENABLE_OBJC_ARC": "YES", "SWIFT_VERSION": "5.0", "IPHONEOS_DEPLOYMENT_TARGET": "17.0"}) for mode in ["Debug", "Release"]]
configlist = add("project-configs", "XCConfigurationList", buildConfigurations=configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
project = add("project", "PBXProject", attributes={"LastUpgradeCheck": "1640", "TargetAttributes": {target_ids["WorkspaceTests"]: {"TestTargetID": target_ids["TacticusIOS"]}, target_ids["WorkspaceUITests"]: {"TestTargetID": target_ids["TacticusIOS"]}}}, buildConfigurationList=configlist,
              compatibilityVersion="Xcode 14.0", developmentRegion="en", hasScannedForEncodings=0, knownRegions=["en", "Base"], mainGroup=main, productRefGroup=products_group, projectDirPath="", projectRoot="", targets=targets)
folder = ROOT / "TacticusIOS.xcodeproj"
folder.mkdir(exist_ok=True)
text = "// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n"
text += "\n".join(f"{key} = {atom(value)};" for key, value in objects.items())
(folder / "project.pbxproj").write_text(text + f"\n}}; rootObject = {project}; }}\n")
scheme = folder / "xcshareddata/xcschemes/TacticusIOS.xcscheme"
scheme.parent.mkdir(parents=True, exist_ok=True)
def buildref(name):
    return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target_ids[name]}" BuildableName="{name}.{"app" if name == "TacticusIOS" else "xctest"}" BlueprintName="{name}" ReferencedContainer="container:TacticusIOS.xcodeproj"/>'
scheme.write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1640" version="1.7">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{buildref("TacticusIOS")}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>{''.join(f'<TestableReference skipped="NO">{buildref(n)}</TestableReference>' for n in ["WorkspaceTests", "WorkspaceUITests"])}</Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildref("TacticusIOS")}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildref("TacticusIOS")}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')

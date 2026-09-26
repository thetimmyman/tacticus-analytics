#!/usr/bin/env python3
"""
Tacticus Guild War — Defensive Layout Parser
=============================================
Extracts Guild War defensive building assignments and map rotations from
local Tacticus game data and outputs Discord-ready text blocks.

Usage:
    python tacticus_gw.py              # auto-detect game file
    python tacticus_gw.py path/to/file # manual file path
    python tacticus_gw.py --help

On first run, if the game file can't be auto-detected, the script will
prompt you for the path and remember it for future runs.
"""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import copy
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION — edit these freely
# ─────────────────────────────────────────────────────────────────────────────

GAME_FILE_NAME = "user_progression.json"

# Where the script stores its own data (mapping, snapshots, config)
SCRIPT_DIR = Path(__file__).resolve().parent
MAPPING_FILE = SCRIPT_DIR / "player_mapping.json"
MAP_MAPPING_FILE = SCRIPT_DIR / "map_mapping.json"
SNAPSHOT_FILE = SCRIPT_DIR / "last_snapshot.json"
CONFIG_FILE = SCRIPT_DIR / "config.json"

# Internal zone type → label used in the DEFENDERS report (only 8 buildings)
BUILDING_MAP = {
    "AntiAirBattery1": "Anti-Air Battery 1",
    "AntiAirBattery2": "Anti-Air Battery 2",
    "ArtilleryPosition1": "Artillery Position 1",
    "ArtilleryPosition2": "Artillery Position 2",
    "Bunker1": "FP 1",
    "Bunker2": "FP 2",
    "MedicaeStation1": "Medicae Station 1",
    "MedicaeStation2": "Medicae Station 2",
}

# Internal zone type → label used in the MAPS report (all 15 buildings)
# Trenches are renamed to Left FL / Mid FL / Right FL and Coms → Vox Station
ALL_BUILDING_LABELS = {
    "AntiAirBattery1": "Anti-Air Battery 1",
    "AntiAirBattery2": "Anti-Air Battery 2",
    "ArtilleryPosition1": "Artillery Position 1",
    "ArtilleryPosition2": "Artillery Position 2",
    "Bunker1": "FP 1",
    "Bunker2": "FP 2",
    "MedicaeStation1": "Medicae Station 1",
    "MedicaeStation2": "Medicae Station 2",
    "HQ": "HQ",
    "SupplyDepot": "Supply Depot",
    "ComsStation": "Vox Station",
    "Armoury": "Armoury",
    "Trenches1": "Left FL",
    "Trenches2": "Mid FL",
    "Trenches3": "Right FL",
}

# Display order for output (top to bottom)
BUILDING_ORDER = [
    "AntiAirBattery1",
    "AntiAirBattery2",
    "ArtilleryPosition1",
    "ArtilleryPosition2",
    "Bunker1",
    "Bunker2",
    "MedicaeStation1",
    "MedicaeStation2",
]

# Grouping for visual separators (each group gets a divider line after it)
BUILDING_GROUPS = [
    ["AntiAirBattery1", "AntiAirBattery2"],
    ["ArtilleryPosition1", "ArtilleryPosition2"],
    ["Bunker1", "Bunker2"],
    ["MedicaeStation1", "MedicaeStation2"],
]

# Types to skip entirely (these aren't paired defender slots)
SKIP_TYPES = {"Trenches1", "Trenches2", "Trenches3", "HQ", "SupplyDepot", "ComsStation", "Armoury"}

# Guild War component types that contain the defensive layout
GW_COMPONENT_TYPES = {"GuildWarPrep", "GuildWarLive", "GuildWar"}

DIVIDER = "—" * 50


# ─────────────────────────────────────────────────────────────────────────────
# CONFIG (remembers the game file path between runs)
# ─────────────────────────────────────────────────────────────────────────────

def load_config():
    """Load the config file. Returns dict, empty if missing/invalid."""
    if not CONFIG_FILE.exists():
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_config(config):
    """Save the config file."""
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[WARN] Couldn't save config: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# PATH DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def get_game_paths():
    """Return a list of candidate paths for the Tacticus data folder, OS-aware."""
    system = platform.system()
    paths = []

    if system == "Windows":
        local_low = Path(os.environ.get("APPDATA", "")).parent / "LocalLow"
        paths.append(local_low / "Snowprint" / "Warhammer 40,000_ Tacticus")
        # Fallback: check all users
        try:
            for user_dir in Path("C:/Users").iterdir():
                candidate = user_dir / "AppData" / "LocalLow" / "Snowprint" / "Warhammer 40,000_ Tacticus"
                if candidate.exists() and candidate not in paths:
                    paths.append(candidate)
        except (OSError, PermissionError):
            pass

    elif system == "Darwin":  # macOS
        home = Path.home()
        # Standard macOS app support paths for Tacticus
        paths.append(home / "Library" / "Application Support" / "com.snowprintstudios.tacticus")
        paths.append(home / "Library" / "Application Support" / "Snowprint" / "Warhammer 40,000_ Tacticus")
        paths.append(home / "Library" / "Application Support" / "com.Snowprint.Warhammer40000Tacticus")
        # Also check sandboxed app containers
        containers = home / "Library" / "Containers"
        if containers.exists():
            for container in containers.iterdir():
                candidate = container / "Data" / "Library" / "Application Support" / "com.snowprintstudios.tacticus"
                if candidate.exists():
                    paths.append(candidate)

    elif system == "Linux":
        home = Path.home()
        paths.append(home / ".config" / "unity3d" / "Snowprint" / "Warhammer 40,000_ Tacticus")

    return paths


def prompt_for_game_path():
    """
    Interactively ask the user for the game file path.
    Returns Path or None if they skipped/cancelled.
    """
    system = platform.system()
    print()
    print("=" * 60)
    print("  GAME FILE NOT FOUND — let's locate it together")
    print("=" * 60)
    print()
    print(f"  We're looking for: {GAME_FILE_NAME}")
    print()
    print("  Typical location:")
    if system == "Windows":
        print(r"    C:\Users\<your-username>\AppData\LocalLow\Snowprint\Warhammer 40,000_ Tacticus\user_progression.json")
        print()
        print("  Tip: the AppData folder is hidden by default in File Explorer.")
        print("       Paste this in the Run dialog (Win+R) to jump there:")
        print(r"       %APPDATA%\..\LocalLow\Snowprint")
    elif system == "Darwin":
        print("    ~/Library/Application Support/com.snowprintstudios.tacticus/user_progression.json")
        print()
        print("  Tip: in Finder, press Cmd+Shift+G and paste:")
        print("       ~/Library/Application Support/com.snowprintstudios.tacticus")
    else:
        print("    ~/.config/unity3d/Snowprint/Warhammer 40,000_ Tacticus/user_progression.json")
    print()
    print("  Once you've found the file, paste its full path below.")
    print("  (Or press Enter to skip and exit.)")
    print()

    raw = input("  Path to user_progression.json: ").strip()
    if not raw:
        return None

    # Strip surrounding quotes that drag-and-drop on some OSes adds
    raw = raw.strip('"').strip("'")
    p = Path(raw).expanduser()

    if p.is_dir():
        candidate = p / GAME_FILE_NAME
        if candidate.is_file():
            return candidate
        print(f"  [ERROR] Folder exists but no {GAME_FILE_NAME} inside it.")
        return None

    if p.is_file():
        return p

    print(f"  [ERROR] Path doesn't exist: {p}")
    return None


def find_game_file(manual_path=None):
    """
    Locate user_progression.json:
    1. If passed via CLI, use that.
    2. Try saved config from previous run.
    3. Try OS-default auto-detect paths.
    4. Prompt user interactively, save their answer.
    """
    # 1. CLI override
    if manual_path:
        p = Path(manual_path).expanduser()
        if p.is_file():
            return p
        if p.is_dir():
            candidate = p / GAME_FILE_NAME
            if candidate.is_file():
                return candidate
        print(f"[ERROR] Specified path not found: {manual_path}")
        sys.exit(1)

    # 2. Saved config from previous run
    config = load_config()
    saved_path = config.get("game_file_path")
    if saved_path:
        p = Path(saved_path)
        if p.is_file():
            print(f"[OK] Using saved game file path: {p}")
            return p
        else:
            print(f"[WARN] Saved game path no longer exists: {saved_path}")
            print("       Will try auto-detect, then prompt if needed.")

    # 3. Auto-detect default OS paths
    for folder in get_game_paths():
        candidate = folder / GAME_FILE_NAME
        if candidate.is_file():
            print(f"[OK] Found game file: {candidate}")
            # Save for next run
            config["game_file_path"] = str(candidate)
            save_config(config)
            return candidate

    # 4. Couldn't find — prompt user
    print()
    print("[INFO] Could not auto-detect Tacticus game file.")
    print(f"       System: {platform.system()}")
    print("       Searched these locations:")
    for folder in get_game_paths():
        print(f"         {folder}")

    found = prompt_for_game_path()
    if found:
        print(f"[OK] Found game file: {found}")
        config["game_file_path"] = str(found)
        save_config(config)
        return found

    print()
    print("[ERROR] No game file provided. Exiting.")
    print()
    print("  Once you find the file, you can either:")
    print(f"    - Run again and paste the path when prompted, or")
    print(f'    - Run: python {Path(__file__).name} "path/to/user_progression.json"')
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# JSON PARSING
# ─────────────────────────────────────────────────────────────────────────────

def load_json(filepath):
    """Load and return the parsed JSON."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Invalid JSON in {filepath}: {e}")
        sys.exit(1)
    except OSError as e:
        print(f"[ERROR] Cannot read {filepath}: {e}")
        sys.exit(1)


def find_gw_component(data):
    """
    Scan liveEvents for the Guild War component that contains defendingFrontline.
    Handles changing indices and multiple possible component type names.
    """
    live_events = data.get("liveEvents", {}).get("liveEvents", [])
    if not live_events:
        print("[ERROR] No liveEvents found in JSON.")
        sys.exit(1)

    # Strategy 1: find any component with defendingFrontline (most robust)
    for event in live_events:
        for comp in event.get("components", []):
            team = comp.get("team")
            if isinstance(team, dict) and "defendingFrontline" in team:
                comp_type = comp.get("type", "unknown")
                event_id = event.get("liveEventId", "unknown")
                print(f"[OK] Found defensive layout in event '{event_id}' (type: {comp_type})")
                return comp

    # Strategy 2: fallback — look for known GW type names
    for event in live_events:
        for comp in event.get("components", []):
            if comp.get("type") in GW_COMPONENT_TYPES:
                team = comp.get("team")
                if isinstance(team, dict):
                    return comp

    print("[ERROR] No Guild War defensive layout found in the current game data.")
    print("        This might mean no war is currently active or in preparation.")
    sys.exit(1)


def extract_layout(component):
    """
    Extract building assignments from the GW component.
    Returns: (layout_dict, new_building_types)

    layout_dict: { internal_name: { "part1": userId|None, "part2": userId|None } }
    new_building_types: list of zone types found that aren't in BUILDING_MAP or SKIP_TYPES
    """
    frontline = component["team"]["defendingFrontline"]
    war_zones = frontline["warZones"]

    layout = {}
    new_building_types = []

    for row in war_zones:
        for zone in row:
            zone_type = zone.get("warZoneType", "")

            if zone_type in SKIP_TYPES:
                continue

            # Auto-detect new paired buildings (anything with a trailing digit)
            if zone_type not in BUILDING_MAP:
                new_building_types.append(zone_type)
                # Auto-generate a label: "SomeName1" → "Some Name 1"
                label = re.sub(r'(\d+)$', r' \1', zone_type)
                label = re.sub(r'([a-z])([A-Z])', r'\1 \2', label)
                BUILDING_MAP[zone_type] = label
                # Auto-add to order and create a group if paired
                if zone_type not in BUILDING_ORDER:
                    BUILDING_ORDER.append(zone_type)
                    # Try to find the pair and group them
                    match = re.match(r'^(.+?)(\d+)$', zone_type)
                    if match:
                        base, num = match.group(1), match.group(2)
                        pair = [z for z in BUILDING_ORDER if z.startswith(base) and z != zone_type]
                        if pair:
                            # Find if pair already has a group, add to it
                            found_group = False
                            for group in BUILDING_GROUPS:
                                if pair[0] in group:
                                    group.append(zone_type)
                                    found_group = True
                                    break
                            if not found_group:
                                BUILDING_GROUPS.append([pair[0], zone_type])
                        # else: single so far, will get grouped when its pair appears

            part1_id = zone.get("zonePart1", {}).get("occupiedByUserId") or None
            part2_id = zone.get("zonePart2", {}).get("occupiedByUserId") or None

            layout[zone_type] = {
                "part1": part1_id,
                "part2": part2_id,
            }

    # Any new buildings that are still ungrouped (solo, no pair yet) get their own group
    grouped = {b for group in BUILDING_GROUPS for b in group}
    for b in BUILDING_ORDER:
        if b not in grouped:
            BUILDING_GROUPS.append([b])

    return layout, new_building_types


def extract_grid(component):
    """
    Extract the full 5x3 zone grid in its natural game order,
    then reverse rows so Trenches appear at the bottom (as requested).
    Returns: list of rows (each row is a list of zone_type strings), ordered
             top → bottom as you want them displayed.
    """
    war_zones = component["team"]["defendingFrontline"]["warZones"]
    # Grid comes in with Trenches at row 0; flip so Trenches is last row.
    grid = []
    for row in war_zones:
        grid.append([z.get("warZoneType", "") for z in row])
    grid.reverse()
    return grid


def extract_map_configs(component):
    """
    Extract map board IDs for every zone type from component.config.zoneTypeConfigs.
    Returns: dict of { zone_type: boardId }
    """
    configs = component.get("config", {}).get("zoneTypeConfigs", {})
    result = {}
    for zone_type, cfg in configs.items():
        board_id = cfg.get("boardId")
        if board_id:
            result[zone_type] = board_id
    return result


# ─────────────────────────────────────────────────────────────────────────────
# MAP MAPPING (boardId → nickname + Discord URL)
# ─────────────────────────────────────────────────────────────────────────────

def load_map_mapping():
    """Load the map mapping file. Returns dict of { boardId: {nickname, url} }."""
    if not MAP_MAPPING_FILE.exists():
        return {}
    try:
        with open(MAP_MAPPING_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        print(f"[WARN] Could not read {MAP_MAPPING_FILE}, starting fresh.")
        return {}


def save_map_mapping(map_mapping):
    """Save the map mapping file."""
    with open(MAP_MAPPING_FILE, "w", encoding="utf-8") as f:
        json.dump(map_mapping, f, indent=2, ensure_ascii=False)
    print(f"[OK] Map mapping saved to {MAP_MAPPING_FILE}")


def prompt_for_new_maps(new_board_ids, map_mapping):
    """
    Interactively prompt for nickname + URL for any boardId we haven't seen.
    Mutates map_mapping in place.
    """
    if not new_board_ids:
        return False

    print()
    print("=" * 60)
    print("  NEW MAP(S) FOUND — Please provide nickname + Discord URL")
    print("=" * 60)
    print("  These map IDs appeared in-game but aren't in map_mapping.json.")
    print("  Press Enter at any prompt to skip that map.")
    print()

    added_any = False
    for board_id in new_board_ids:
        print(f"  Map ID: {board_id}")
        nickname = input("    Nickname (e.g. 'Grasslands'): ").strip()
        url = input("    Discord channel URL (optional): ").strip()
        if nickname or url:
            map_mapping[board_id] = {
                "nickname": nickname or f"[{board_id}]",
                "url": url,
            }
            added_any = True
        print()

    return added_any


# ─────────────────────────────────────────────────────────────────────────────
def extract_members(component, full_data):
    """
    Build a userId → displayName lookup from all available sources.
    Checks both the GW component members and the guild roster.
    """
    members = {}

    # Source 1: guildWarGuildData inside the war component
    gw_members = (
        component.get("team", {})
        .get("guildWarGuildData", {})
        .get("members", [])
    )
    for m in gw_members:
        uid = m.get("userId")
        name = m.get("displayName")
        if uid and name:
            members[uid] = name

    # Source 2: guild roster
    guild_members = (
        full_data.get("guilds", {})
        .get("guildState", {})
        .get("Members", [])
    )
    for m in guild_members:
        user = m.get("user", {})
        uid = user.get("userId")
        name = user.get("displayName")
        if uid and name and uid not in members:
            members[uid] = name

    return members


# ─────────────────────────────────────────────────────────────────────────────
# PLAYER MAPPING
# ─────────────────────────────────────────────────────────────────────────────

def load_mapping():
    """Load the player mapping file. Returns list of player dicts."""
    if not MAPPING_FILE.exists():
        return []
    try:
        with open(MAPPING_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        print(f"[WARN] Could not read {MAPPING_FILE}, starting fresh.")
        return []


def save_mapping(mapping):
    """Save the player mapping file."""
    with open(MAPPING_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2, ensure_ascii=False)
    print(f"[OK] Mapping saved to {MAPPING_FILE}")


def build_mapping_index(mapping):
    """
    Build fast lookup dicts from the mapping list.
    Returns: (by_user_id, by_display_name)
    """
    by_uid = {}
    by_name = {}
    for entry in mapping:
        uid = entry.get("userId", "")
        if uid:
            by_uid[uid] = entry
        name = entry.get("displayName", "")
        if name:
            by_name[name.lower()] = entry
        for alias in entry.get("aliases", []):
            by_name[alias.lower()] = entry
    return by_uid, by_name


def bootstrap_mapping(members_dict, existing_mapping):
    """
    Merge newly found members into the mapping.
    Returns (updated_mapping, list_of_new_entries).
    """
    existing_uids = {e["userId"] for e in existing_mapping if "userId" in e}
    new_entries = []

    for uid, display_name in sorted(members_dict.items(), key=lambda x: x[1]):
        if uid not in existing_uids:
            entry = {
                "userId": uid,
                "displayName": display_name,
                "discordHandle": "",
                "aliases": [],
            }
            new_entries.append(entry)

    # Also update displayNames for existing entries if they changed in-game
    uid_to_name = {e["userId"]: e for e in existing_mapping}
    for uid, display_name in members_dict.items():
        if uid in uid_to_name and uid_to_name[uid].get("displayName") != display_name:
            old = uid_to_name[uid]["displayName"]
            uid_to_name[uid]["displayName"] = display_name
            print(f"[INFO] Updated display name: '{old}' → '{display_name}'")

    updated = existing_mapping + new_entries
    return updated, new_entries


def prompt_for_new_users(new_entries):
    """
    Interactive prompt asking the user to provide Discord handles for new players.
    """
    if not new_entries:
        return

    print()
    print("=" * 60)
    print("  NEW PLAYERS FOUND — Please provide Discord handles")
    print("=" * 60)
    print("  Enter the Discord username (e.g. someuser123)")
    print("  Press Enter to skip and fill in later.")
    print()

    for entry in new_entries:
        name = entry["displayName"]
        uid_short = entry["userId"][:8]
        handle = input(f"  [{uid_short}…] {name:20s} → @").strip()
        if handle:
            # Strip leading @ if they typed it
            handle = handle.lstrip("@")
            entry["discordHandle"] = handle


def resolve_user(user_id, members_dict, by_uid, by_name):
    """
    Resolve a userId to the best available display string.
    Returns: (display_string, is_mapped)

    Priority:
    1. Exact userId match in mapping → use discordHandle if set
    2. Exact displayName match in mapping → use discordHandle if set
    3. Fall back to displayName with ⚠️ flag
    4. Fall back to truncated userId
    """
    if not user_id:
        return "BLANK", False

    display_name = members_dict.get(user_id, "")

    # Try userId match
    if user_id in by_uid:
        entry = by_uid[user_id]
        handle = entry.get("discordHandle", "")
        if handle:
            return f"@{handle}", True
        # Has entry but no discord handle
        name = entry.get("displayName", display_name or user_id[:8])
        return f"{name} ⚠️", False

    # Try displayName match
    if display_name and display_name.lower() in by_name:
        entry = by_name[display_name.lower()]
        handle = entry.get("discordHandle", "")
        if handle:
            return f"@{handle}", True
        return f"{display_name} ⚠️", False

    # No match at all
    if display_name:
        return f"{display_name} ⚠️", False
    return f"[{user_id[:12]}…] ⚠️", False


# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT FORMATTING
# ─────────────────────────────────────────────────────────────────────────────

# Short labels for the compact Discord format (used by both Defenders reports).
# Falls back to BUILDING_MAP labels for any building not listed here.
SHORT_BUILDING_LABELS = {
    "AntiAirBattery1": "Anti-Air 1",
    "AntiAirBattery2": "Anti-Air 2",
    "ArtilleryPosition1": "Artillery 1",
    "ArtilleryPosition2": "Artillery 2",
    "Bunker1": "FP 1",
    "Bunker2": "FP 2",
    "MedicaeStation1": "Medicae 1",
    "MedicaeStation2": "Medicae 2",
}

# Ultra-short abbreviations for the Maps Grid report — matches the verbal
# shorthand officers use in chat (MS1 / AP1 / MS2, etc.).
SHORT_MAP_LABELS = {
    "AntiAirBattery1": "AA1",
    "AntiAirBattery2": "AA2",
    "ArtilleryPosition1": "AP1",
    "ArtilleryPosition2": "AP2",
    "Bunker1": "FP1",
    "Bunker2": "FP2",
    "MedicaeStation1": "MS1",
    "MedicaeStation2": "MS2",
    "HQ": "HQ",
    "SupplyDepot": "SD",
    "ComsStation": "VOX",
    "Armoury": "AR",
    "Trenches1": "L-FL",
    "Trenches2": "M-FL",
    "Trenches3": "R-FL",
}

# Map nickname overrides for the grid view, where the full nickname is too
# long to fit cleanly in a fixed-width cell. Keys are boardIds — falls back
# to the regular nickname from map_mapping.json if not listed here.
# Add your own here if you want shorter grid labels for specific maps.
GRID_NICKNAME_OVERRIDES = {
    "LHE_Desert_03": "Oasis(WW)",       # "Oasis (Wonderwall)"
    "CE2_06": "Deathleaper",            # "Deathleapers Cove"
    "PVP_desert_10": "AFUITM",          # already short
    "C1_37": "3 Bridges",               # "Three Bridges"
    "C1_23": "Snipers",                 # "Sniper's Nests"
    "C1_70": "5 Pillars",               # "Five Pillars"
    "C1_45": "Aleph Nest",              # "Aleph's Nest"
}

# Width of each cell in the maps grid (characters). Tuned for Discord mobile
# code-block rendering — 3 cells × 11 chars + separators stays under ~40 chars.
GRID_CELL_WIDTH = 11

GROUP_SEPARATOR = "———"


def _format_compact_defenders(layout, slot_renderer):
    """
    Shared layout for the compact Discord format.

    `slot_renderer(uid)` is a callable that returns the display string for a
    given user_id (or None for an empty slot). This keeps the line-building
    logic in one place — 1A passes a resolver that returns @handles, 1B
    passes one that returns in-game display names.
    """
    lines = []

    for i, group in enumerate(BUILDING_GROUPS):
        if i > 0:
            lines.append(GROUP_SEPARATOR)
        for internal_name in group:
            label = SHORT_BUILDING_LABELS.get(
                internal_name, BUILDING_MAP.get(internal_name, internal_name)
            )
            slots = layout.get(internal_name, {"part1": None, "part2": None})
            user1 = slot_renderer(slots["part1"])
            user2 = slot_renderer(slots["part2"])
            lines.append(f"**{label}:** {user1} & {user2}")

    return "\n".join(lines)


def format_bold_output(layout, members_dict, by_uid, by_name):
    """
    Compact Discord format with @-pings — the canonical pinning report.

    Renders one line per building: **Short Label:** @user1 & @user2
    Uses bold + colon for visual scannability instead of column alignment,
    so it renders cleanly on mobile regardless of handle length.
    """
    unmapped = []

    def render(uid):
        if not uid:
            return "BLANK"
        display, mapped = resolve_user(uid, members_dict, by_uid, by_name)
        if not mapped:
            unmapped.append(uid)
        return display

    output = _format_compact_defenders(layout, render)

    # Build the structured unmapped list (building, slot, uid, name) that
    # the warning section in main() expects.
    unmapped_uids = set(unmapped)
    structured_unmapped = []
    if unmapped_uids:
        for group in BUILDING_GROUPS:
            for internal_name in group:
                label = SHORT_BUILDING_LABELS.get(
                    internal_name, BUILDING_MAP.get(internal_name, internal_name)
                )
                slots = layout.get(internal_name, {"part1": None, "part2": None})
                for slot_key, slot_label in [("part1", "slot 1"), ("part2", "slot 2")]:
                    uid = slots.get(slot_key)
                    if uid and uid in unmapped_uids:
                        structured_unmapped.append(
                            (label, slot_label, uid, members_dict.get(uid, "?"))
                        )

    return output, structured_unmapped


def format_ingame_output(layout, members_dict):
    """
    Compact Discord format with in-game display names — for officer chat
    where you don't want to spam pings.
    """
    def render(uid):
        if not uid:
            return "BLANK"
        name = members_dict.get(uid)
        if not name:
            return f"[{uid[:8]}…] ⚠️"
        return name

    return _format_compact_defenders(layout, render)


def _truncate_nickname(nickname, board_id, width):
    """
    Return a fixed-width cell-friendly nickname.
    1. Check GRID_NICKNAME_OVERRIDES first
    2. Truncate to `width` chars if still too long
    """
    if board_id in GRID_NICKNAME_OVERRIDES:
        return GRID_NICKNAME_OVERRIDES[board_id]
    if len(nickname) <= width:
        return nickname
    # Truncate with no ellipsis (saves a char) — overrides exist for the
    # cases where this would mangle a name unhelpfully.
    return nickname[:width]


def format_maps_grid(grid, map_configs, map_mapping):
    """
    REPORT 2A — Maps Grid.

    Compact code-block grid mirroring the in-game layout. Two lines per
    grid row: abbreviation row, then nickname row, separated by a blank
    line between grid rows for breathing room.

    Output is wrapped in a ``` code block so Discord mobile renders it
    monospaced (alignment survives). No clickable links — that's REPORT 2B's
    job. Use this for "where is everything?" at a glance.
    """
    w = GRID_CELL_WIDTH
    sep = " | "
    lines = ["**Guild War — Maps (layout)**", "```"]

    for row_idx, row in enumerate(grid):
        if row_idx > 0:
            lines.append("")  # blank line between grid rows
        # Build label row + nickname row in lockstep
        label_cells = []
        nick_cells = []
        for zone_type in row:
            label = SHORT_MAP_LABELS.get(zone_type, zone_type[:w])
            board_id = map_configs.get(zone_type)
            if board_id:
                map_info = map_mapping.get(board_id, {})
                raw_nick = map_info.get("nickname") or board_id
                nick = _truncate_nickname(raw_nick, board_id, w)
            else:
                nick = "—"
            label_cells.append(label.ljust(w))
            nick_cells.append(nick.ljust(w))
        lines.append(sep.join(label_cells).rstrip())
        lines.append(sep.join(nick_cells).rstrip())

    lines.append("```")
    return "\n".join(lines)


def format_maps_index(grid, map_configs, map_mapping):
    """
    REPORT 2B — Maps Index (clickable links, grouped by grid row).

    Plain markdown (NOT a code block — links need to render). Each grid row
    becomes one Discord line of three building→map links separated by ` · `.

    Returns: (output_string, unknown_board_ids)
    """
    def _row_heading(row_index, total_rows):
        if row_index == total_rows - 1:
            return "FL:"
        if row_index == 0:
            return "Top:"
        return f"{row_index + 1}:"

    lines = ["**Guild War — Maps (links)**", ""]
    unknown_board_ids = []
    total_rows = len(grid)

    for row_index, row in enumerate(grid):
        lines.append(f"**{_row_heading(row_index, total_rows)}**")
        cells = []
        for zone_type in row:
            label = SHORT_MAP_LABELS.get(zone_type, zone_type)
            board_id = map_configs.get(zone_type)
            if not board_id:
                cells.append(f"{label}: *no map*")
                continue
            map_info = map_mapping.get(board_id)
            if map_info and map_info.get("url"):
                nickname = map_info.get("nickname", f"[{board_id}]")
                cells.append(f"{label}: [{nickname}]({map_info['url']})")
            elif map_info:
                nickname = map_info.get("nickname", board_id)
                cells.append(f"{label}: {nickname} ⚠️")
            else:
                unknown_board_ids.append(board_id)
                cells.append(f"{label}: `{board_id}` ⚠️")
        lines.append(" · ".join(cells))
        lines.append("")  # spacing between rows

    # Dedupe unknowns while preserving order
    seen = set()
    unique_unknowns = []
    for bid in unknown_board_ids:
        if bid not in seen:
            seen.add(bid)
            unique_unknowns.append(bid)

    return "\n".join(lines).rstrip(), unique_unknowns


# ─────────────────────────────────────────────────────────────────────────────
# CHANGE TRACKING
# ─────────────────────────────────────────────────────────────────────────────

def load_snapshot():
    """Load previous snapshot if it exists."""
    if not SNAPSHOT_FILE.exists():
        return None
    try:
        with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def save_snapshot(layout, members_dict, by_uid, by_name, map_configs, map_mapping):
    """Save current layout + map assignments as a snapshot for future comparison."""
    snapshot = {
        "timestamp": datetime.now().isoformat(),
        "buildings": {},
        "maps": {},
    }
    # Defender assignments
    for internal_name in BUILDING_ORDER:
        if internal_name not in layout:
            continue
        slots = layout[internal_name]
        label = BUILDING_MAP.get(internal_name, internal_name)
        user1, _ = resolve_user(slots["part1"], members_dict, by_uid, by_name)
        user2, _ = resolve_user(slots["part2"], members_dict, by_uid, by_name)
        snapshot["buildings"][internal_name] = {
            "label": label,
            "user1": user1,
            "user2": user2,
            "uid1": slots["part1"] or "",
            "uid2": slots["part2"] or "",
        }

    # Map assignments (all 15 buildings)
    for zone_type, board_id in map_configs.items():
        nickname = map_mapping.get(board_id, {}).get("nickname", board_id)
        snapshot["maps"][zone_type] = {
            "boardId": board_id,
            "nickname": nickname,
        }

    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
    return snapshot


def compare_snapshots(previous, current):
    """
    Compare two snapshots.
    Returns: (defender_changes, map_changes) — two lists of change descriptions.
    """
    if not previous:
        return [], []

    defender_changes = []
    map_changes = []

    # Defender diffs
    prev_buildings = previous.get("buildings", {})
    curr_buildings = current.get("buildings", {})
    for internal_name in BUILDING_ORDER:
        label = BUILDING_MAP.get(internal_name, internal_name)
        prev = prev_buildings.get(internal_name, {})
        curr = curr_buildings.get(internal_name, {})
        for slot, slot_label in [("user1", "slot 1"), ("user2", "slot 2")]:
            old_val = prev.get(slot, "BLANK")
            new_val = curr.get(slot, "BLANK")
            if old_val != new_val:
                defender_changes.append(f"  {label} {slot_label}: {old_val} → {new_val}")

    # Map diffs
    prev_maps = previous.get("maps", {})
    curr_maps = current.get("maps", {})
    for zone_type, curr_entry in curr_maps.items():
        label = ALL_BUILDING_LABELS.get(zone_type, zone_type)
        prev_entry = prev_maps.get(zone_type, {})
        old_nickname = prev_entry.get("nickname", "—")
        new_nickname = curr_entry.get("nickname", "—")
        if old_nickname != new_nickname:
            map_changes.append(f"  {label}: {old_nickname} → {new_nickname}")

    return defender_changes, map_changes


# ─────────────────────────────────────────────────────────────────────────────
# CLIPBOARD
# ─────────────────────────────────────────────────────────────────────────────

def copy_to_clipboard(text):
    """
    Copy `text` to the system clipboard using OS-native tools.
    No external Python deps — uses pbcopy / clip / xclip / xsel.
    Returns True on success, False otherwise.
    """
    system = platform.system()

    try:
        if system == "Darwin":
            subprocess.run(
                ["pbcopy"], input=text, text=True, encoding="utf-8", check=True
            )
            return True

        if system == "Windows":
            # `clip` is built into Windows. It expects UTF-16-LE on stdin to
            # handle non-ASCII (em-dashes, ⚠️, etc.) correctly.
            subprocess.run(
                ["clip"], input=text.encode("utf-16-le"), check=True
            )
            return True

        if system == "Linux":
            for cmd in (["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"], ["wl-copy"]):
                if shutil.which(cmd[0]):
                    subprocess.run(cmd, input=text, text=True, encoding="utf-8", check=True)
                    return True
            return False

    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return False

    return False


def interactive_copy_menu(reports):
    """
    Loop showing the copy menu until the user quits.
    `reports` is a dict with keys: '1a', '1b', '2a', '2b' (strings).
    """
    options = {
        "1": ("Defenders with Discord handles (Report 1A)", lambda: reports["1a"]),
        "2": ("Defenders with in-game names (Report 1B)", lambda: reports["1b"]),
        "3": ("Defence Layout / Maps Grid (Report 2A)", lambda: reports["2a"]),
        "4": ("Maps Index with links (Report 2B)", lambda: reports["2b"]),
        "5": ("Both map reports (2A + 2B)", lambda: reports["2a"] + "\n\n" + reports["2b"]),
        "6": ("Everything (1A + 1B + 2A + 2B)", lambda: "\n\n".join(
            [reports["1a"], reports["1b"], reports["2a"], reports["2b"]]
        )),
    }

    print("━" * 60)
    print("  COPY TO CLIPBOARD")
    print("━" * 60)
    print()
    for key, (label, _) in options.items():
        print(f"    {key}  →  {label}")
    print()
    print("    q  →  Quit (or just press Enter)")
    print()

    while True:
        choice = input("  Choose what to copy: ").strip().lower()

        if choice in ("", "q", "quit", "exit"):
            print("  [DONE] Bye!")
            return

        if choice not in options:
            print(f"  [?] '{choice}' isn't a valid option. Try 1–6 or q.")
            continue

        label, getter = options[choice]
        text = getter()
        if copy_to_clipboard(text):
            print(f"  [✓] Copied: {label}")
            print(f"      ({len(text)} chars on clipboard — paste into Discord)")
        else:
            print(f"  [✗] Clipboard tool not available on this system.")
            print(f"      Falling back to printing the content below — copy manually:")
            print()
            print(text)
            print()
        print()


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║   Tacticus Guild War — Defensive Layout Parser      ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    # Determine file path
    manual_path = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "--help" else None
    if "--help" in sys.argv:
        print(__doc__)
        sys.exit(0)

    filepath = find_game_file(manual_path)

    # Load and parse
    data = load_json(filepath)
    component = find_gw_component(data)
    layout, new_building_types = extract_layout(component)
    members_dict = extract_members(component, data)

    print(f"[OK] Found {len(layout)} buildings, {len(members_dict)} guild members")

    # Alert about newly discovered building types
    if new_building_types:
        print()
        print("!" * 60)
        print("  NEW BUILDING TYPE(S) DETECTED:")
        for bt in new_building_types:
            auto_label = BUILDING_MAP.get(bt, bt)
            print(f"    {bt}  →  auto-labelled as '{auto_label}'")
        print()
        print("  These have been auto-added to this run's output.")
        print("  To customise the labels, add them to BUILDING_MAP")
        print("  in tacticus_gw.py")
        print("!" * 60)
        print()

    # Verify we got the buildings we expect
    missing_buildings = [b for b in BUILDING_ORDER if b not in layout]
    if missing_buildings:
        print(f"[WARN] Missing buildings in layout: {', '.join(missing_buildings)}")

    # Load / bootstrap player mapping — always check for new IDs
    mapping = load_mapping()
    is_first_run = not MAPPING_FILE.exists()
    mapping, new_entries = bootstrap_mapping(members_dict, mapping)

    if new_entries:
        if is_first_run:
            print()
            print("=" * 60)
            print("  FIRST RUN — let's set up your guild's Discord handles")
            print("=" * 60)
            print(f"  Found {len(new_entries)} guild members in the game data.")
            print("  We'll go through each one — type their Discord username")
            print("  (e.g. someuser123) or press Enter to skip.")
            print()
            print("  You can always edit player_mapping.json later to update")
            print("  handles or fix typos.")
        else:
            print(f"[INFO] {len(new_entries)} new player(s) found!")
        prompt_for_new_users(new_entries)
        save_mapping(mapping)
    elif not MAPPING_FILE.exists():
        save_mapping(mapping)
        print(f"[INFO] Created initial mapping file with {len(mapping)} players.")
        print(f"       Edit {MAPPING_FILE} to add Discord handles.")
    else:
        # Even without new entries, save if display names were updated
        save_mapping(mapping)

    by_uid, by_name = build_mapping_index(mapping)

    # ─── Map handling ───────────────────────────────────────────
    grid = extract_grid(component)
    map_configs = extract_map_configs(component)
    map_mapping = load_map_mapping()
    map_file_existed_before = MAP_MAPPING_FILE.exists()

    # Detect any boardIds present in-game but missing from map_mapping.json
    used_board_ids = list(dict.fromkeys(map_configs.values()))  # preserve order, dedupe
    missing_board_ids = [bid for bid in used_board_ids if bid not in map_mapping]

    if missing_board_ids:
        if not map_file_existed_before:
            print()
            print("=" * 60)
            print("  FIRST RUN — let's set up your map nicknames + Discord links")
            print("=" * 60)
            print(f"  Found {len(missing_board_ids)} maps in the current rotation.")
            print("  For each one you can provide:")
            print("    - A short nickname (e.g. 'Grasslands')")
            print("    - The Discord channel URL where you discuss that map")
            print("  Press Enter on either prompt to skip — you can fill in later")
            print(f"  by editing map_mapping.json")
        else:
            print(f"[INFO] {len(missing_board_ids)} new map ID(s) found in-game.")
        if prompt_for_new_maps(missing_board_ids, map_mapping):
            save_map_mapping(map_mapping)
        elif not map_file_existed_before:
            # Create empty map_mapping.json so the user has something to edit
            save_map_mapping(map_mapping)

    # Generate defender output
    bold_output, unmapped = format_bold_output(layout, members_dict, by_uid, by_name)
    ingame_output = format_ingame_output(layout, members_dict)

    # Generate map outputs (grid + linked index)
    maps_grid_output = format_maps_grid(grid, map_configs, map_mapping)
    maps_index_output, still_unknown = format_maps_index(grid, map_configs, map_mapping)

    # ─── Change tracking ────────────────────────────────────────
    previous_snapshot = load_snapshot()
    current_snapshot = save_snapshot(layout, members_dict, by_uid, by_name, map_configs, map_mapping)
    defender_changes, map_changes = compare_snapshots(previous_snapshot, current_snapshot)

    # ─── Print results ──────────────────────────────────────────
    print()
    print("━" * 60)
    print("  REPORT 1A — DEFENDERS (with @-pings)")
    print("  → pin once per season")
    print("━" * 60)
    print()
    print(bold_output)
    print()

    print("━" * 60)
    print("  REPORT 1B — DEFENDERS (in-game names, no pings)")
    print("  → use in officer chat to avoid spamming @ mentions")
    print("━" * 60)
    print()
    print(ingame_output)
    print()

    print("━" * 60)
    print("  REPORT 2A — MAPS GRID (spatial layout, no links)")
    print("  → post fresh each time maps rotate")
    print("  → glanceable, mirrors in-game grid")
    print("━" * 60)
    print()
    print(maps_grid_output)
    print()

    print("━" * 60)
    print("  REPORT 2B — MAPS INDEX (clickable links)")
    print("  → post alongside 2A — tap to jump to map channel")
    print("━" * 60)
    print()
    print(maps_index_output)
    print()

    # Show change logs
    if defender_changes or map_changes:
        print("━" * 60)
        print("  CHANGELOG — since last run")
        print("━" * 60)
        ts = previous_snapshot.get("timestamp", "unknown") if previous_snapshot else "n/a"
        print(f"  (compared to snapshot from {ts})")
        print()
        if defender_changes:
            print("  Defender changes:")
            for change in defender_changes:
                print(change)
            print()
        if map_changes:
            print("  Map changes:")
            for change in map_changes:
                print(change)
            print()
    elif previous_snapshot:
        print("[OK] No changes since last run.")
        print()

    # Show unmapped player warnings
    if unmapped:
        print("━" * 60)
        print("  ⚠️  UNMAPPED PLAYERS — need Discord handles")
        print("━" * 60)
        for building, slot, uid, name in unmapped:
            print(f"  {building} ({slot}): {name} [{uid[:12]}…]")
        print()
        print(f"  → Edit {MAPPING_FILE} to add their discordHandle")
        print()

    # Show unmapped map warnings
    if still_unknown:
        print("━" * 60)
        print("  ⚠️  UNMAPPED MAPS — need nickname + URL")
        print("━" * 60)
        for bid in still_unknown:
            print(f"  {bid}")
        print()
        print(f"  → Edit {MAP_MAPPING_FILE} to add them")
        print()

    # ─── Interactive copy menu ──────────────────────────────────
    print()
    reports = {
        "1a": bold_output,
        "1b": ingame_output,
        "2a": maps_grid_output,
        "2b": maps_index_output,
    }
    interactive_copy_menu(reports)
    print()


if __name__ == "__main__":
    main()

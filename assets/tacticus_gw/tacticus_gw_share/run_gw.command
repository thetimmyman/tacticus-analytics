#!/bin/bash
cd "$(dirname "$0")"

# Check Python 3 is available
if ! command -v python3 >/dev/null 2>&1; then
    echo ""
    echo "[ERROR] python3 is not installed."
    echo ""
    echo "  macOS usually ships with Python 3, but if not, the easiest"
    echo "  option is to install it from https://www.python.org/downloads/"
    echo "  or via Homebrew: brew install python3"
    echo ""
    echo "Press Enter to close..."
    read
    exit 1
fi

python3 tacticus_gw.py
echo ""
echo "Press Enter to close..."
read

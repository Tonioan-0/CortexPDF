"""
Application entry point.
Starts the FastAPI backend server and opens the UI in a PyWebView window.
"""

import os
import sys
import threading
import time
from pathlib import Path

# Load .env
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

PORT = 8765


def run_server():
    import uvicorn
    sys.path.insert(0, str(Path(__file__).parent / "backend"))
    uvicorn.run(
        "backend.server:app",
        host="127.0.0.1",
        port=PORT,
        log_level="info",
    )


def wait_for_server(timeout=15):
    import httpx
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            httpx.get(f"http://127.0.0.1:{PORT}/api/health", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    # Start server in a background thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # Wait for it to be ready
    print("Starting backend server…")
    if not wait_for_server():
        print("ERROR: Backend server did not start in time.", file=sys.stderr)
        sys.exit(1)

    print(f"Backend ready at http://127.0.0.1:{PORT}")

    # Open PyWebView window
    try:
        import webview
        window = webview.create_window(
            "PDF AI Summarizer",
            url=f"http://127.0.0.1:{PORT}/",
            width=1400,
            height=900,
            min_size=(800, 600),
            resizable=True,
        )
        webview.start(debug=False)
    except ImportError:
        # Fallback: open in system browser
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{PORT}/")
        print("PyWebView not available — opened in browser instead.")
        print("Press Ctrl+C to quit.")
        server_thread.join()


if __name__ == "__main__":
    main()

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from asago_demo.runtime import Coordinator, Settings
from asago_demo.server import make_handler


@pytest.fixture
def server(tmp_path):
    coordinator = Coordinator(tmp_path, Settings(tmp_path, defaults={"api_key": "secret-value"}))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(coordinator))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}", coordinator
    httpd.shutdown()
    httpd.server_close()


def test_status_does_not_disclose_secrets(server):
    base, _ = server
    with urllib.request.urlopen(base + "/api/state") as response:
        data = response.read().decode()
    assert "secret-value" not in data
    assert json.loads(data)["settings"]["api_key_configured"]


def test_browser_requests_cannot_start_jobs_cross_origin(server):
    base, _ = server
    request = urllib.request.Request(
        base + "/api/start",
        data=b'{"stage":"policy"}',
        headers={
            "Origin": "https://unrelated.example",
            "X-Asago-Demo": "1",
        },
    )
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(request)
    assert error.value.code == 403


def test_html_outputs_are_sandboxed_and_traversal_blocked(server):
    base, coordinator = server
    (coordinator.runs / "test.html").write_text("<script>fetch('/api/state')</script>")
    with urllib.request.urlopen(base + "/files/test.html") as response:
        assert "connect-src 'none'" in response.headers["Content-Security-Policy"]
        assert "allow-same-origin" not in response.headers["Content-Security-Policy"]
    with pytest.raises(urllib.error.HTTPError):
        urllib.request.urlopen(base + "/files/../settings.json")

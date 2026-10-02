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


@pytest.mark.parametrize(
    "provider,url,key",
    [
        ("litellm", "https://proxy.example/v1", "secret-value"),
        ("ollama", "http://localhost:11434", "ollama"),
    ],
)
def test_model_discovery_uses_draft_service_without_saving(
    server, monkeypatch, provider, url, key
):
    import httpx

    base, coordinator = server
    seen = []

    def models(request):
        seen.append((str(request.url), request.headers.get("Authorization")))
        return httpx.Response(
            200, json={"data": [{"id": "qwen"}, {"id": "gemma"}, {"id": "qwen"}]}
        )

    with httpx.Client(transport=httpx.MockTransport(models)) as client:
        monkeypatch.setattr(httpx, "get", client.get)
        request = urllib.request.Request(
            base + "/api/models",
            data=json.dumps(
                {
                    "provider": provider,
                    "base_url": url,
                    "api_key": "",
                }
            ).encode(),
            headers={"X-Asago-Demo": "1"},
        )
        with urllib.request.urlopen(request) as response:
            result = json.load(response)
    assert result["models"] == ["gemma", "qwen"]
    assert seen == [
        (url.rstrip("/") + ("/v1" if provider == "ollama" else "") + "/models", "Bearer " + key)
    ]
    assert not coordinator.settings.path.exists()

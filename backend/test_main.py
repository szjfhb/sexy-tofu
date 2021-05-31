from fastapi.testclient import TestClient

from backend.src.main import app

client = TestClient(app)


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Say hi to Sexy Tofu!"}


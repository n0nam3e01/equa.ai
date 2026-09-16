"""Локальная точка входа. Один сервер отдаёт HTML и API, поэтому CORS не нужен."""
import uvicorn

if __name__ == "__main__":
    # Только loopback: MVP без авторизации не предназначен для публичной сети.
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000)

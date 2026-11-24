from fastapi import FastAPI, HTTPException, Query

from app.forecast_service import forecast, forecast_all_hospitals

app = FastAPI(title="MedNexus ML Forecast Service", version="1.0.0")


@app.get("/health")
def health():
    return {"success": True, "service": "ml-service"}


@app.get("/forecast/hospitals")
def hospitals_forecast():
    try:
        return {"success": True, "data": forecast_all_hospitals()}
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="ML forecast failed") from error


@app.get("/forecast/hospitals/{hospital_id}")
def hospital_forecast(
    hospital_id: int,
    hours: float = Query(default=6, ge=0.5, le=24),
):
    try:
        return {"success": True, "data": forecast(hospital_id, hours)}
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="ML forecast failed") from error

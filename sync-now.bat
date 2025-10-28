@echo off
echo Running automated sync...
docker exec trakt-sync npm run auto-sync
echo.
echo Sync completed! Check logs in the logs folder.
pause
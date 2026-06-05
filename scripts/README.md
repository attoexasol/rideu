# Backend Scripts

## Location Data Cleanup

### Overview
The `cleanup-old-locations.js` script automatically deletes location data older than 6 months to comply with data retention policies and maintain database performance.

### Manual Execution
```bash
cd backend
node scripts/cleanup-old-locations.js
```

### Automated Execution (Cron Job)

#### Setup on Linux/Mac
1. Open crontab editor:
```bash
crontab -e
```

2. Add the following line to run cleanup daily at 2 AM:
```
0 2 * * * cd /path/to/drivewize-gps-tracking/backend && node scripts/cleanup-old-locations.js >> /var/log/drivewize-cleanup.log 2>&1
```

3. Save and exit

#### Setup on Windows (Task Scheduler)
1. Open Task Scheduler
2. Create new task
3. Set trigger: Daily at 2:00 AM
4. Set action: Run program
   - Program: `node`
   - Arguments: `scripts/cleanup-old-locations.js`
   - Start in: `C:\path\to\drivewize-gps-tracking\backend`

### Verification
Check the cleanup results in the log file:
```bash
tail -f /var/log/drivewize-cleanup.log
```

### Data Retention Policy
- **Retention Period:** 6 months
- **Affected Data:** Location history records (latitude, longitude, timestamps)
- **Preserved Data:** Driver profiles, trip records, vehicle information
- **Cleanup Frequency:** Daily (configurable)

### REST API Alternative
You can also trigger cleanup via the REST API endpoint:
```bash
DELETE /api/locations/cleanup
```

This requires admin authentication and returns the number of deleted records.

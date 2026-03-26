const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const excelPath = path.resolve('data/crime_data_template Fanal DaTa (2).xlsx');
if (!fs.existsSync(excelPath)) {
    console.error(`File not found: ${excelPath}`);
    process.exit(1);
}

const workbook = XLSX.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Read as array of arrays, so row[0] is strictly headers
const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

if (rawData.length > 0) {
    const headerMap = {
        'वर्षे': 'Year',
        'वर्ष': 'Year',
        'महिना': 'Month',
        'पोलीस स्टेशन नांव': 'Police Station',
        'पोलीस स्टेशन': 'Police Station',
        'गुन्हयाचा प्रकार  हेड (वर्गवारी)': 'Crime Type',
        'गुन्हयाचा प्रकार हेड (वर्गवारी)': 'Crime Type',
        'गुन्हयाचा प्रकार जोड': 'Crime Type',
        'गुन्हयाचा प्रकार': 'Crime Type',
        'दाखल ': 'Registered Offence',
        'दाखल': 'Registered Offence',
        'उघड ': 'Detected',
        'उघड': 'Detected'
    };

    const headers = rawData[0];
    for (let i = 0; i < headers.length; i++) {
        if (typeof headers[i] === 'string') {
            const trimmed = headers[i].trim();
            if (headerMap[trimmed]) {
                headers[i] = headerMap[trimmed];
            } else if (headerMap[headers[i]]) {
                headers[i] = headerMap[headers[i]];
            }
        }
    }

    // Convert back to sheet
    const newWorksheet = XLSX.utils.aoa_to_sheet(rawData);
    
    // Set column widths for readability as was defined in excelSync.js previously
    newWorksheet['!cols'] = [
        { wch: 6 },   // Year
        { wch: 6 },   // Month
        { wch: 20 },  // Police Station
        { wch: 25 },  // Crime Type
        { wch: 20 },  // Registered Offence
        { wch: 10 }   // Detected
    ];

    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);

    XLSX.writeFile(newWorkbook, excelPath);
    console.log('Successfully translated Excel file headers to English!');
} else {
    console.log('Excel file is empty.');
}

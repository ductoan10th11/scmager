const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const generateObjectId = () => crypto.randomBytes(12).toString('hex');
const randomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const year = 2026;
const month = 6; // July

const subjects = [
  'Báo cáo tài chính quý 3', 'Chuẩn bị hội nghị giao ban', 'Thẩm định hồ sơ dự án KĐT', 
  'Kiểm tra tiến độ xây dựng', 'Lên lịch công tác tuần', 'Giải quyết khiếu nại công dân',
  'Cập nhật phần mềm hệ thống', 'Đánh giá KPI nhân viên', 'Xử lý công văn số 123/UBND',
  'Rà soát lỗi chính tả văn bản dự thảo', 'Tiếp đoàn thanh tra Sở', 'Gửi giấy mời họp HĐND'
];

const tagsList = [
  ['Giấy mời', 'Quan trọng'], ['Hạn công việc', 'Báo cáo'], ['Khai báo ngày', 'Nội bộ'],
  ['Dự án', 'Phối hợp'], ['IT', 'Bảo trì'], ['Hành chính', 'Văn thư']
];

const people = [
  { _id: { "$oid": generateObjectId() }, fullName: 'Nguyễn Văn A', avatar: 'https://i.pravatar.cc/150?u=a', department: 'Phòng Hành chính' },
  { _id: { "$oid": generateObjectId() }, fullName: 'Trần Thị B', avatar: 'https://i.pravatar.cc/150?u=b', department: 'Phòng Tài chính' }
];

// Định dạng thời gian CHUẨN GMT+7 để tránh lỗi UTC trên Node biến 13h chiều thành 20h đêm!
const getIsoWithVNTimezone = (day, hour, min) => {
  const dYear = year;
  const dMonth = String(month + 1).padStart(2, '0');
  const dDay = String(day).padStart(2, '0');
  const dHour = String(hour).padStart(2, '0');
  const dMin = String(min).padStart(2, '0');
  return `${dYear}-${dMonth}-${dDay}T${dHour}:${dMin}:00.000+07:00`;
};

const getIsoDaysAgo = (day, hour, min, daysAgo) => {
  const targetDate = new Date(year, month, day - daysAgo);
  const dYear = targetDate.getFullYear();
  const dMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dDay = String(targetDate.getDate()).padStart(2, '0');
  const dHour = String(hour).padStart(2, '0');
  const dMin = String(min).padStart(2, '0');
  return `${dYear}-${dMonth}-${dDay}T${dHour}:${dMin}:00.000+07:00`;
};

function generateRandomSlotsForPeriod(startHour, startMin, endHour, endMin) {
  const slots = [];
  let currentTotalMinutes = startHour * 60 + startMin;
  const maxTotalMinutes = endHour * 60 + endMin;

  while (currentTotalMinutes < maxTotalMinutes) {
    // Không có khoảng trống, các task diễn ra tuần tự liên tiếp nhau
    const duration = randomElement([30, 45, 60, 90, 120]);
    
    let endTotalMinutes = currentTotalMinutes + duration;
    
    // Cắt bớt nếu tràn ra ngoài giờ hành chính
    if (endTotalMinutes > maxTotalMinutes) {
      endTotalMinutes = maxTotalMinutes;
    }

    // Luôn tạo task dù thời gian còn lại là bao nhiêu (để đảm bảo lấp đầy 100% lịch trình)
    slots.push({
      startH: Math.floor(currentTotalMinutes / 60),
      startM: currentTotalMinutes % 60,
      endH: Math.floor(endTotalMinutes / 60),
      endM: endTotalMinutes % 60
    });

    currentTotalMinutes = endTotalMinutes;
  }
  return slots;
}

const generateUnifiedData = () => {
  const unified = [];
  let globalIdCount = 0;

  for (let day = 1; day <= 31; day++) {
    for (const person of people) {
      const morningSlots = generateRandomSlotsForPeriod(8, 0, 12, 0);
      const afternoonSlots = generateRandomSlotsForPeriod(13, 30, 17, 30);
      const dailySlots = [...morningSlots, ...afternoonSlots];
      
      for (const slot of dailySlots) {
        
        const priority = randomElement(['low', 'medium', 'high', 'urgent']);
        const status = randomElement(['todo', 'in-progress', 'review', 'done']);
        
        unified.push({
          _id: { "$oid": generateObjectId() },
          documentNumber: `${1000 + globalIdCount}/UBND-VP`,
          title: randomElement(subjects) + ` (Mã: #${1000 + globalIdCount})`,
          description: priority === 'urgent' ? 'Nhiệm vụ khẩn cấp, yêu cầu xử lý ngay lập tức.' : 'Nhiệm vụ chuyên môn chuẩn.',
          type: randomElement(['Họp', 'Công tác', 'Chuyên môn', 'Tiếp dân', 'Nội bộ']),
          status: status,
          priority: priority,
          tags: randomElement(tagsList),
          assignee: person,
          reporter: person === people[0] ? people[1] : people[0],
          startTime: { "$date": getIsoWithVNTimezone(day, slot.startH, slot.startM) },
          endTime: { "$date": getIsoWithVNTimezone(day, slot.endH, slot.endM) },
          location: `Phòng họp số ${randomInt(1, 5)}`,
          createdAt: { "$date": getIsoDaysAgo(day, slot.startH, slot.startM, randomInt(1, 5)) },
          updatedAt: { "$date": getIsoDaysAgo(day, slot.startH, slot.startM, 0) },
          attachments: randomInt(0, 3),
          comments: randomInt(0, 5),
          isOverload: priority === 'urgent'
        });
        
        globalIdCount++;
      }
    }
  }
  
  return unified;
};

const data = generateUnifiedData();
fs.writeFileSync(path.join(__dirname, 'src/mocks/raw_unified.json'), JSON.stringify(data, null, 2));
console.log(`Generated ${data.length} unified documents adhering strictly to Vietnam timezone and full 31 days of 8-hour workdays.`);

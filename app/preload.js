'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Narrow, promise-based API. No raw ipcRenderer or Node APIs reach the renderer.
contextBridge.exposeInMainWorld('db', {
  // auth (session lives in the main process)
  authStatus: () => ipcRenderer.invoke('auth:status'),
  login: (password) => ipcRenderer.invoke('auth:login', { password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (currentPassword, newPassword, confirmation) => ipcRenderer.invoke('auth:changePassword', { currentPassword, newPassword, confirmation }),
  isDefaultPassword: () => ipcRenderer.invoke('auth:isDefaultPassword'),

  // donors
  listDonors: () => ipcRenderer.invoke('donors:list'),
  findDonors: (query) => ipcRenderer.invoke('donors:find', { query }),
  findDonorExact: (fields) => ipcRenderer.invoke('donors:findExact', fields),
  newestEntry: () => ipcRenderer.invoke('donors:newest'),
  insertDonor: (fields) => ipcRenderer.invoke('donors:insert', fields),
  updateDonor: (fields) => ipcRenderer.invoke('donors:update', fields),
  deleteDonor: (titheId) => ipcRenderer.invoke('donors:delete', { titheId }),

  // giving
  listGiving: (search) => ipcRenderer.invoke('giving:list', { search }),
  recordGift: (payload) => ipcRenderer.invoke('giving:recordGift', payload),
  deleteGiving: (id) => ipcRenderer.invoke('giving:delete', { id }),
  findGivingDatesByPerson: (search) => ipcRenderer.invoke('giving:findDates', { search }),
  findGivingByPersonAndDate: (search, date) => ipcRenderer.invoke('giving:findByPersonDate', { search, date }),
  updateGiving: (id, fields) => ipcRenderer.invoke('giving:update', { id, ...fields }),

  // reports
  monthReport: (year, month) => ipcRenderer.invoke('report:month', { year, month }),
  yearReport: (year, opts) => ipcRenderer.invoke('report:year', { year, ...(opts || {}) }),
  otherReport: (year, month) => ipcRenderer.invoke('report:other', { year, month }),
  fundTotals: (year, month) => ipcRenderer.invoke('report:funds', { year, month }),

  // deposits
  listDeposits: () => ipcRenderer.invoke('deposit:list'),
  titheSheetTotal: (date) => ipcRenderer.invoke('deposit:titheSheetTotal', { date }),
  insertDeposit: (payload) => ipcRenderer.invoke('deposit:insert', payload),
  markDepositSkipped: (depositNumber) => ipcRenderer.invoke('deposit:markSkipped', { depositNumber }),
  deleteDeposit: (depositNumber) => ipcRenderer.invoke('deposit:delete', { depositNumber }),

  // csv
  importDonors: (rows) => ipcRenderer.invoke('csv:importDonors', rows),
  importGiving: (rows) => ipcRenderer.invoke('csv:importGiving', rows),
  exportDonors: () => ipcRenderer.invoke('csv:exportDonors'),
  exportGiving: () => ipcRenderer.invoke('csv:exportGiving'),

  // settings + email
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  setEmailRecipients: (list) => ipcRenderer.invoke('settings:setRecipients', { list }),
  sendDepositEmail: (payload) => ipcRenderer.invoke('email:sendDeposit', payload),

  // misc
  getXlsxTemplate: () => ipcRenderer.invoke('app:getTemplate'),
  backupDatabase: () => ipcRenderer.invoke('db:backup'),
  getDbInfo: () => ipcRenderer.invoke('db:getInfo'),
  chooseDbFile: () => ipcRenderer.invoke('db:choose'),
  resetDbFile: () => ipcRenderer.invoke('db:resetDefault'),
});

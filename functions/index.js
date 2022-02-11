const admin = require('firebase-admin')
const functions = require("firebase-functions");
const moment = require("moment");
//const xl = require('excel4node');
//const excel = require("exceljs")
const ExcelJS = require('exceljs');
const path = require('path');
const os = require('os');

admin.initializeApp();

const db = admin.firestore();


/**
 * Creates a document with ID -> uid in the `Users` collection.
 *
 * @param {Object} userRecord Contains the auth, uid and displayName info.
 * @param {Object} context Details about the event.
 */
const admin_uid = '7ffpzdD1cxdHbsz9ipLOigb3ZEC2'

const sendPush = (title, body, FCMToken) => {
  const payload = {
    token: FCMToken,
    notification: {
      title,
      body,
    },
    data: {
      body,
    }
  }
  admin.messaging().send(payload).then((response) => {
    // Response is a message ID string.
    console.log('Successfully sent message:', response);
    return { success: true };
  }).catch((error) => {
    return { error: error.code };
  });
}

const createProfile = async (userRecord, context) => {
  const { email, uid } = userRecord;

  const chat = await db
    .collection("chats")
    .doc(uid)
    .set({
      interlocutors: [
        db.doc('users/' + admin_uid),
        db.doc('users/' + uid),
      ],
      messages: []
    })
    .catch(console.error);


  return db
    .collection("users")
    .doc(uid)
    .set({
      uid: uid,
      email,
      name: null,
      surname: null,
      avatar: null,
      active_day: 1,
      is_notification: true,
      last_time_completed_at: null,
      created_at: (new Date()).getTime(),
      answered_questions: [],
      fcm_token: null,
    })
    .catch(console.error);
};

const sendNotificationWhenNewMessage = async (change, context) => {
  const chatDoc = await change.after.data()
  if (chatDoc.messages[chatDoc.messages.length - 1].author.id === admin_uid) {
    const myIndex = chatDoc.interlocutors[0].id === admin_uid ? 1 : 0
    const res = await chatDoc.interlocutors[myIndex].get()
    const userDoc = await res.data()
    const FCMToken = userDoc.fcm_token
    sendPush(
      'New message from Coach',
      chatDoc.messages[chatDoc.messages.length - 1].text,
      FCMToken
    )
  }
}

const check = async (context) => {
  const users = db.collection('users')
  const data = await users.get()
  data.docs.forEach(user_obj => {
    const user = user_obj.data()
    const oneDayAgoTime = moment().subtract(1, 'days').startOf('day').valueOf()
    if (
      user.fcm_token
      && user.last_time_completed_at
      && user.last_time_completed_at < oneDayAgoTime
      && moment(user.last_time_completed_at).add(4, 'days').endOf('day').valueOf() > moment().startOf('day').valueOf()
    )
      sendPush(
        'Missing exercises',
        'You have missed exercises',
        user.fcm_token,
      )
  })
  return null;
}

const checkSubscription = async (context) => {
  const users = db.collection('users')
  const data = await users.get()
  data.docs.forEach(user_obj => {
    const user = user_obj.data()
    const now = moment().endOf('day').valueOf()
    if (
      (
        moment(user.created_at).add(178, 'days').endOf('day').valueOf() < now
        &&
        moment(user.created_at).add(180, 'days').endOf('day').valueOf() > now
      )
      ||
      (
        moment(user.created_at).add(165, 'days').endOf('day').valueOf() < now
        &&
        moment(user.created_at).add(167, 'days').endOf('day').valueOf() > now
      )
      ||
      (
        moment(user.created_at).add(149, 'days').endOf('day').valueOf() < now
        &&
        moment(user.created_at).add(151, 'days').endOf('day').valueOf() > now
      )
    ) {
      sendPush(
        'Subscription',
        'Your membership is about to expire',
        user.fcm_token,
      )
    }
  })
  return null;
}

const createExcelFile = async (change, context) => {
  const excelDoc = await change.after.data()
  const firestore = () => db

  if (excelDoc.isGenerating) {
    const daysReady2load = firestore().collection('progress') // just ready
    const daysFBobj = await daysReady2load.get() // fb big obj
    //console.log(daysFBobj.docs[0].id) // id of document
    //console.log(daysFBobj.docs[0].data()) // document properties
    const days = daysFBobj.docs.map(day => ({
      id: day.id,
      questions: day.data().questions,
    }))
    //console.log(days[0].questions[0].id, 'dfdfdfdfd')

    const ids = days.map(day => day.id)
    ids.sort((a, b) => (parseInt(a) - parseInt(b)))
    const sorted_days = []
    ids.forEach(id => {
      days.forEach(day => {
        if (day.id === id)
          sorted_days.push(day)
      })
    })

    const usersReady2load = firestore().collection('users')
    const usersFBobj = await usersReady2load.get()
    const answered_users = []
    usersFBobj.docs.forEach(user_obj => {
      const user = user_obj.data()
      if (user.answered_questions?.length)
        answered_users.push(user)
    })

    const questionsReady2load = firestore().collection('questions')
    const questionsFBobj = await questionsReady2load.get()
    const questions = questionsFBobj.docs.map(question_obj => {
      const question = question_obj.data()
      question.id = question_obj.id
      return { ...question }
    })

    const tabs = []

    sorted_days.forEach(day => {
      const tab = {
        name: 'Day ' + day.id,
        otherRows: [],
        firstRow: [
          { header: 'User ID', key: 'user_id', width: 35 },
          { header: 'Name', key: 'name', width: 25 },
          { header: 'Email', key: 'email', width: 30, },
          { header: 'Completed date', key: 'completed_date', width: 26, },
          ...day.questions.map((question) => ({
            header: questions.find(question2 => (question2.id === question.id)).question, key: question.id, width: 80,
          }))
        ],
      }
      answered_users.forEach(user => {
        if (
          day.questions.some(
            question => (user.answered_questions.some(
              answered_question => answered_question.question_id === question.id)
            )
          )
        ) {
          tab.otherRows.push({
            user_id: user.uid,
            name: (`${user.name || ''} ${user.surname || ''}`),
            email: user.email,
            completed_date:
              user.progress_check_days_completed_dates?.some(c_date => c_date.day == day.id)
                ? moment(
                  user.progress_check_days_completed_dates.find(c_date => c_date.day == day.id).completed_at
                ).format('MM.DD.YYYY - hh:mm')
                :
                '',
            ...day.questions.map((questionOfDay) => {
              let answer2obj = ''
              const found_answered_question = user.answered_questions.find(
                answered_question => (answered_question.question_id === questionOfDay.id)
              )
              if (found_answered_question) {
                if (found_answered_question.type === 'text')
                  answer2obj = found_answered_question.text_answer
                else if (found_answered_question.answers?.length) {
                  found_answered_question.answers.forEach(answer => {
                    questions.forEach(question => {
                      if (question.id === questionOfDay.id) {
                        if (question.answers.some(answer2 => (answer == answer2.value))) {
                          answer2obj += (answer2obj.length ? ', ' : '') + question
                            .answers
                            .find(answer2 => (answer === answer2.value)).text
                        }
                      }
                    })
                  })
                }
              }
              return {
                [questionOfDay.id]: answer2obj
              }
            }).reduce((obj, item) => ({
              ...obj,
              ...item,
            }), {})
          });
        }
      })
      tabs.push(tab)
    })

    //console.log(tabs, 'tabs')

    const workbook = new ExcelJS.Workbook();
    tabs.map((tab) => {
      const worksheet = workbook.addWorksheet(tab.name);
      worksheet.columns = [...tab.firstRow]
      tab.otherRows.map(row => {
        worksheet.addRow({ ...row })
      })
    })

    // Upload exported file to Firebase Storage and remove temp file
    //const tempLocalFile = path.join(os.tmpdir(), excelDoc.name+'.xlsx');
    const name = moment().format('MMMM-DD-YYYY___h-mm-ss')
    const tempLocalFile = os.tmpdir() + '/' + name + '.xlsx'
    return workbook.xlsx.writeFile(tempLocalFile).then(async () => {
      await admin.storage().bucket('gs://happysneeze---app.appspot.com').upload(tempLocalFile, {
        destination: `excel/${name}.xlsx`
      });
      firestore()
        .collection("system")
        .doc('excel')
        .update({
          name,
          isGenerating: false,
        })
      return null;
    });
  }
}

module.exports = {
  authOnCreate: functions.auth.user().onCreate(createProfile),
  sendNotificationWhenNewMessage: functions.firestore
    .document('chats/{userId}')
    .onUpdate(sendNotificationWhenNewMessage),
  //check: functions.pubsub.schedule('every 1 minutes').onRun(check),
  check: functions.pubsub.schedule('00 09 * * *')
    .timeZone('America/Los_Angeles') // Users can choose timezone - default is America/Los_Angeles // Europe/Kiev
    .onRun(check),
  checkSubscription: functions.pubsub.schedule('5 10 * * *')
    .timeZone('America/Los_Angeles')
    .onRun(checkSubscription),
  createExcelFile: functions.firestore
    .document('system/excel')
    .onUpdate(createExcelFile),
}
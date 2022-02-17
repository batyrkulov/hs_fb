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
      last_action: null,
      got_notification_after24h_from_last_action: false,
      got_notification_after48h_from_last_action: false,
      first_login_at: null,
      got_message_after6h_from_first_login: false,
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

const checkUsersLastActions = async (context) => {
  const users = db.collection('users')
  const data = await users.get()
  data.docs.forEach(user_obj => {
    const user = user_obj.data()
    if (
      user.fcm_token
      && user.last_action
    ) {
      if (
        (user.last_action + (60000 * 60 * 24) < Date.now())
        && !user.got_notification_after24h_from_last_action
      ) {
        sendPush(
          'HappySneeze',
          'Hey, we missed you!',
          user.fcm_token,
        )
        db
          .collection("users")
          .doc(user.uid)
          .update({
            got_notification_after24h_from_last_action: true,
          })
      }
      if (
        (user.last_action + (60000 * 60 * 48) < Date.now())
        && !user.got_notification_after48h_from_last_action
      ) {
        sendPush(
          'HappySneeze',
          'If you need some help, talk to us. We are here to assist you.',
          user.fcm_token,
        )
        db
          .collection("users")
          .doc(user.uid)
          .update({
            got_notification_after48h_from_last_action: true,
          })
      }
    }
  })
  return null;
}

const sendMessageAfter6hFromFirstLogin = async (context) => {
  const doc = db.collection('users').doc(admin_uid)
  const adminData = await doc.get()
  const admin_name = adminData.data().name

  const users = db.collection('users')
  const data = await users.get()
  data.docs.forEach(user_obj => {
    const user = user_obj.data()
    if (
      user.fcm_token
      && user.first_login_at
    ) {
      if (
        (user.first_login_at + (60000 * 60 * 6) < Date.now())
        && !user.got_message_after6h_from_first_login
      ) {
        db
          .collection("chats")
          .doc(user.uid) // chat id === uid
          .update({
            messages: admin.firestore.FieldValue.arrayUnion({
              text: `
Hi${user.name ? ', '+ user.name : ''}. My name is ${admin_name} and I’m going to be your coach for the next
40 days. Don’t hesitate to ask me any questions you might have. I’m here to help. :)
                `,
              createdAt: new Date(),
              author: db.doc("users/" + admin_uid),
            }),
          })
        db
          .collection("users")
          .doc(user.uid)
          .update({
            got_message_after6h_from_first_login: true,
          })
      }
    }
  })
  return null;
}

const sendEveryDayMessage = async (context) => {
  const users = db.collection('users')
  const data = await users.get()
  data.docs.forEach(user_obj => {
    const user = user_obj.data()
    sendPush(
      'HappySneeze',
      'Hey, let’s HappySneeze today!',
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
    ) {
      sendPush(
        'Subscription',
        'Your membership is about to expire',
        user.fcm_token,
      )
    }
    if ((
      moment(user.created_at).add(149, 'days').endOf('day').valueOf() < now
      &&
      moment(user.created_at).add(151, 'days').endOf('day').valueOf() > now
    )) {
      sendPush(
        'Subscription',
        'Your subscription ends in one month. We will miss you!',
        user.fcm_token,
      )
    }
    if ((
      moment(user.created_at).add(172, 'days').endOf('day').valueOf() < now
      &&
      moment(user.created_at).add(174, 'days').endOf('day').valueOf() > now
    )) {
      db
        .collection("chats")
        .doc(user.uid) // chat id === uid
        .update({
          messages: admin.firestore.FieldValue.arrayUnion({
            text: `
I hope I have been able to provide the help you needed during these days.
It’s a happy goodbye! We hope you leave us much better than when you came.
Have tones of HappySneezes, smiles, jumps...
                `,
            createdAt: new Date(),
            author: db.doc("users/" + admin_uid),
          }),
        })
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

const createSecondExcelFile = async (change, context) => {
  const excel2Doc = await change.after.data()
  const firestore = () => db

  if (excel2Doc.isGenerating) {
    const progressesReady2load = firestore().collection('progress')
    const progressesFBobj = await progressesReady2load.get()
    const progresses = progressesFBobj.docs.map(ps => ({
      id: ps.id,
      questions: ps.data().questions,
    }))

    const questionsWithPoints = []
    const questionsReady2load = firestore().collection('questions')
    const questionsFBobj = await questionsReady2load.get()
    questionsFBobj.docs.forEach(question_obj => {
      const question = question_obj.data()
      question.id = question_obj.id
      question.progressDay = parseInt(
        progresses.find(
          progress => progress.questions.some(q => q.id === question.id)
        )?.id
      )
      if (question.withPoint) questionsWithPoints.push(question)
    })

    const users_with_points = []
    const usersReady2load = firestore().collection('users')
    const usersFBobj = await usersReady2load.get()
    usersFBobj.docs.forEach(user_obj => {
      const user = user_obj.data()
      if (user.answered_questions?.length) {
        if (user.answered_questions.some(a_question => questionsWithPoints.some(
          questionsWithPoint => (questionsWithPoint.id === a_question.question_id)
        ))) {
          users_with_points.push(user)
        }
      }
    })

    const tab = {
      name: 'Results',
      otherRows: [],
      firstRow: [
        { header: 'User ID', key: 'user_id', width: 35 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Email', key: 'email', width: 30, },
        { header: 'Day 1', key: 'day1', width: 15, },
        { header: 'Day 10', key: 'day10', width: 15, },
        { header: 'Day 20', key: 'day20', width: 15, },
        { header: 'Day 30', key: 'day30', width: 15, },
        { header: 'Day 40', key: 'day40', width: 15, },
        { header: 'Results', key: 'results', width: 15, },
        { header: 'Completion', key: 'completion', width: 15, },
      ],
    }

    const total = {
      day1: {
        pointsSumm: 0,
        usersCount: 0
      },
      day10: {
        pointsSumm: 0,
        usersCount: 0
      },
      day20: {
        pointsSumm: 0,
        usersCount: 0
      },
      day30: {
        pointsSumm: 0,
        usersCount: 0
      },
      day40: {
        pointsSumm: 0,
        usersCount: 0
      },
      results: {
        pointsSumm: 0,
        usersCount: 0
      },
      completion: {
        percentsSumm: 0,
        usersCount: 0
      }
    }

    const calculateForUser = (user) => {
      const userResults = {
        day1: 0,
        day10: 0,
        day20: 0,
        day30: 0,
        day40: 0,
        results: 0,
        completion: 0,
      }
      user.answered_questions.forEach(a_question => {
        questionsWithPoints.forEach(questionsWithPoint => {
          if (questionsWithPoint.id === a_question.question_id && questionsWithPoint.type !== 'text') {
            let pointOfCurrentAnsweredQuestion = 0
            a_question.answers.forEach(answer => {
              pointOfCurrentAnsweredQuestion += questionsWithPoint.answers.find(answer2 => answer2.value === answer).point
            })
            switch (questionsWithPoint.progressDay) {
              case 1: {
                userResults.day1 += pointOfCurrentAnsweredQuestion
                break;
              }
              case 10: {
                userResults.day10 += pointOfCurrentAnsweredQuestion
                break;
              }
              case 20: {
                userResults.day20 += pointOfCurrentAnsweredQuestion
                break;
              }
              case 30: {
                userResults.day30 += pointOfCurrentAnsweredQuestion
                break;
              }
              case 40: {
                userResults.day40 += pointOfCurrentAnsweredQuestion
                break;
              }
            }
          }
        })
      })

      if (userResults.day1 > 0 && userResults.day40 > 0) {
        userResults.results = (userResults.day1 - userResults.day40)
        if (userResults.results) {
          total.results.usersCount++
          total.results.pointsSumm += userResults.results
        }
      }

      if (user.progress_check_days_completed_dates?.length) {
        userResults.completion = user.progress_check_days_completed_dates.reduce((res, curent) => {
          return (res + [10, 20, 30, 40].some(n => n === curent.day) ? 25 : 0)
        }, 0)
        if (userResults.completion) {
          total.completion.usersCount++
          total.completion.percentsSumm += userResults.completion
        }
      }

      if (userResults.day1) {
        total.day1.usersCount++
        total.day1.pointsSumm += userResults.day1
      }
      if (userResults.day10) {
        total.day10.usersCount++
        total.day10.pointsSumm += userResults.day10
      }
      if (userResults.day20) {
        total.day20.usersCount++
        total.day20.pointsSumm += userResults.day20
      }
      if (userResults.day30) {
        total.day30.usersCount++
        total.day30.pointsSumm += userResults.day30
      }
      if (userResults.day40) {
        total.day40.usersCount++
        total.day40.pointsSumm += userResults.day40
      }

      userResults.completion = (userResults.completion + '%')
      return userResults
    }

    users_with_points.forEach(user => {
      tab.otherRows.push({
        user_id: user.uid,
        name: (`${user.name || ''} ${user.surname || ''}`),
        email: user.email,
        ...calculateForUser(user),
      })
    })
    tab.otherRows.push({
      user_id: '',
      name: '',
      email: '',
      day1: '',
      day10: '',
      day20: '',
      day30: '',
      day40: '',
      results: '',
      completion: '',
    })
    tab.otherRows.push({
      user_id: 'TOTAL',
      name: '',
      email: '',
      day1: 'Avarage result for Progress Check Day 1',
      day10: 'Avarage result for Progress Check Day 10',
      day20: 'Avarage result for Progress Check Day 20',
      day30: 'Avarage result for Progress Check Day 30',
      day40: 'Avarage result for Progress Check Day 40',
      results: 'Avarage results',
      completion: 'Avarage completion',
    })
    tab.otherRows.push({
      user_id: '',
      name: '',
      email: '',
      day1: total.day1.pointsSumm ? Math.round(total.day1.pointsSumm / total.day1.usersCount) : 0,
      day10: total.day10.pointsSumm ? Math.round(total.day10.pointsSumm / total.day10.usersCount) : 0,
      day20: total.day20.pointsSumm ? Math.round(total.day20.pointsSumm / total.day20.usersCount) : 0,
      day30: total.day30.pointsSumm ? Math.round(total.day30.pointsSumm / total.day30.usersCount) : 0,
      day40: total.day40.pointsSumm ? Math.round(total.day40.pointsSumm / total.day40.usersCount) : 0,
      results: total.results.pointsSumm ? Math.round(total.results.pointsSumm / total.results.usersCount) : 0,
      completion: `${total.completion.percentsSumm ? Math.round(total.completion.percentsSumm / total.completion.usersCount) : 0}%`,
    })

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(tab.name);
    worksheet.columns = [...tab.firstRow]
    tab.otherRows.map(row => {
      worksheet.addRow({ ...row })
    })

    let name = moment().format('MMMM-DD-YYYY___h-mm-ss')
    name = 'second_' + name
    const tempLocalFile = os.tmpdir() + '/' + name + '.xlsx'
    return workbook.xlsx.writeFile(tempLocalFile).then(async () => {
      await admin.storage().bucket('gs://happysneeze---app.appspot.com').upload(tempLocalFile, {
        destination: `excel/${name}.xlsx`
      });
      firestore()
        .collection("system")
        .doc('excel2')
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
  sendMessageAfter6hFromFirstLogin: functions.pubsub.schedule('every 5 minutes').onRun(sendMessageAfter6hFromFirstLogin),
  checkUsersLastActions: functions.pubsub.schedule('every 30 minutes').onRun(checkUsersLastActions),
  check: functions.pubsub.schedule('00 09 * * *')
    .timeZone('America/Los_Angeles') // Users can choose timezone - default is America/Los_Angeles // Europe/Kiev
    .onRun(check),
  sendEveryDayMessage: functions.pubsub.schedule('00 12 * * *')
    .timeZone('America/Los_Angeles') // Users can choose timezone - default is America/Los_Angeles // Europe/Kiev
    .onRun(sendEveryDayMessage),
  checkSubscription: functions.pubsub.schedule('5 10 * * *')
    .timeZone('America/Los_Angeles')
    .onRun(checkSubscription),
  createExcelFile: functions.firestore
    .document('system/excel')
    .onUpdate(createExcelFile),
  createSecondExcelFile: functions.firestore
    .document('system/excel2')
    .onUpdate(createSecondExcelFile),
}